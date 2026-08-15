import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { Group, LocalForwardRule, SessionConfig, TunnelState } from '../types/via'
import { isTunnelState } from '../types/via'

export interface ViaBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>
}

export interface RuntimeSnapshot {
  rules: Array<{ ruleId: string; state: TunnelState; message: string | null }>
  connectedSessionIds: string[]
}

export interface PersistedConfig {
  schemaVersion: number
  groups: Group[]
  sessions: SessionConfig[]
  rules: LocalForwardRule[]
}

export interface AppPreferences {
  language: 'system' | 'zh-CN' | 'en'
  fontSize: 'small' | 'medium' | 'large'
  theme: 'system' | 'light' | 'dark'
}

const defaultPreferences: AppPreferences = {
  language: 'system',
  fontSize: 'medium',
  theme: 'system',
}

function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.rules)) return null
  const rules: RuntimeSnapshot['rules'] = []
  for (const item of record.rules) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.ruleId !== 'string' || typeof entry.state !== 'string' || !isTunnelState(entry.state)) return null
    if (entry.message !== undefined && entry.message !== null && typeof entry.message !== 'string') return null
    rules.push({
      ruleId: entry.ruleId,
      state: entry.state,
      message: typeof entry.message === 'string' ? entry.message : null,
    })
  }
  const connected = record.connectedSessionIds
  if (connected !== undefined && !Array.isArray(connected)) return null
  const connectedSessionIds = (connected ?? []).filter((id): id is string => typeof id === 'string')
  return { rules, connectedSessionIds }
}

export type InitializationState = 'idle' | 'connecting' | 'ready' | 'failed'

export interface ViaStore {
  groups: Group[]
  sessions: SessionConfig[]
  rules: LocalForwardRule[]
  connectedSessionIds: string[]
  initialized: boolean
  initializationState: InitializationState
  secretStoreConfigured: boolean | null
  preferences: AppPreferences
  initialize(): Promise<void>
  reloadConfig(): Promise<void>
  save(): Promise<void>
  loadPreferences(): Promise<void>
  savePreferences(preferences: AppPreferences): Promise<void>
  changeMasterPassword(currentPassword: string, newPassword: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  deleteGroup(groupId: string): Promise<void>
  deleteRule(ruleId: string): Promise<void>
  createGroup(group: Group): Promise<void>
  refreshSecretStoreStatus(): Promise<string[] | null>
  initializeSecrets(masterPassword: string): Promise<string[]>
  unlockSecrets(masterPassword: string): Promise<string[] | null>
  recoverSecrets(recoveryCode: string, newMasterPassword: string): Promise<string[]>
  saveSessionSecret(sessionId: string, secret: string): Promise<void>
  connectSession(sessionId: string): Promise<void>
  disconnectSession(sessionId: string): Promise<void>
  approveHostKey(host: string, port: number, algorithm: string, fingerprint: string): Promise<void>
  startRule(ruleId: string): Promise<void>
  stopRule(ruleId: string): Promise<void>
  startEnabledRules(sessionId: string): Promise<void>
  stopSessionRules(sessionId: string): Promise<void>
  exportConfig(): Promise<string>
  importConfig(json: string, replaceAll: boolean): Promise<void>
}

const bridge: ViaBridge = {
  async invoke<T>(command: string, args?: Record<string, unknown>) {
    return invoke<T>(command, args)
  },
  async listen<T>(event: string, handler: (payload: T) => void) {
    return listen<T>(event, (payload) => handler(payload.payload))
  },
}

export function createViaStore(runtime: ViaBridge = bridge): ViaStore {
  const state = reactive({
    groups: [] as Group[],
    sessions: [] as SessionConfig[],
    rules: [] as LocalForwardRule[],
    connectedSessionIds: [] as string[],
    initialized: false,
    initializationState: 'idle' as InitializationState,
    secretStoreConfigured: null as boolean | null,
    preferences: { ...defaultPreferences },
  })
  let unsubscribe: (() => void) | undefined
  const reconnectAttempts = new Map<string, number>()
  const reconnectingSessions = new Set<string>()

  const replace = (target: unknown[], values: unknown[]) => target.splice(0, target.length, ...values)
  const snapshot = (): PersistedConfig => ({ schemaVersion: 1, groups: state.groups, sessions: state.sessions, rules: state.rules })
  const replaceConfig = (config: PersistedConfig) => {
    replace(state.groups, config.groups)
    replace(state.sessions, config.sessions)
    replace(state.rules, config.rules.map((rule) => ({ ...rule, runtimeState: rule.runtimeState ?? 'stopped' })))
  }
  const validateRecoveryCodes = (value: unknown): string[] => {
    if (!Array.isArray(value)
      || value.length !== 10
      || value.some((code) => typeof code !== 'string' || code.trim().length === 0)
      || new Set(value).size !== value.length) {
      throw new Error('invalid recovery codes')
    }
    return value as string[]
  }
  const validatePreferences = (value: unknown): AppPreferences => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid preferences')
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length !== 3
      || !keys.includes('language')
      || !keys.includes('fontSize')
      || !keys.includes('theme')
      || !['system', 'zh-CN', 'en'].includes(record.language as string)
      || !['small', 'medium', 'large'].includes(record.fontSize as string)
      || !['system', 'light', 'dark'].includes(record.theme as string)) {
      throw new Error('invalid preferences')
    }
    return {
      language: record.language as AppPreferences['language'],
      fontSize: record.fontSize as AppPreferences['fontSize'],
      theme: record.theme as AppPreferences['theme'],
    }
  }
  const validateUnitResponse = (value: unknown): void => {
    if (value !== null) throw new Error('invalid unit response')
  }
  const refreshSecretStoreStatus = async (): Promise<string[] | null> => {
    const status = await runtime.invoke<unknown>('secret_store_status')
    if (!status || typeof status !== 'object' || typeof (status as { configured?: unknown }).configured !== 'boolean') {
      throw new Error('invalid secret store status')
    }
    state.secretStoreConfigured = (status as { configured: boolean }).configured
    return null
  }
  const reloadConfig = async () => {
    replaceConfig(await runtime.invoke<PersistedConfig>('load_config'))
  }

  return Object.assign(state, {
    async initialize() {
      state.initializationState = 'connecting'
      try {
        let config: PersistedConfig | undefined
        let lastError: unknown
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            config = await runtime.invoke<PersistedConfig>('load_config')
            break
          } catch (error) {
            lastError = error
            if (attempt < 2) await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
          }
        }
        if (!config) throw lastError
        replaceConfig(config)
        await refreshSecretStoreStatus()
        if (!unsubscribe) {
          unsubscribe = await runtime.listen<unknown>('runtime-state', (payload) => {
            const snapshot = parseRuntimeSnapshot(payload)
            if (!snapshot) return
            state.connectedSessionIds = snapshot.connectedSessionIds
            for (const update of snapshot.rules) {
              const rule = state.rules.find((item) => item.id === update.ruleId)
              if (rule) {
                rule.runtimeState = update.state
                if (update.state === 'reconnecting') scheduleReconnect(rule.sessionId)
              }
            }
          })
          window.setInterval(() => { void runtime.invoke('poll_transports').catch(() => undefined) }, 2_000)
        }
        state.initialized = true
        state.initializationState = 'ready'
      } catch (error) {
        state.initializationState = 'failed'
        throw error
      }
    },
    async save() {
      await runtime.invoke('save_config', { config: snapshot() })
    },
    reloadConfig,
    async loadPreferences() {
      state.preferences = validatePreferences(await runtime.invoke<unknown>('load_preferences'))
    },
    async savePreferences(preferences: AppPreferences) {
      const validated = validatePreferences(preferences)
      validateUnitResponse(await runtime.invoke<unknown>('save_preferences', { preferences: validated }))
      state.preferences = validated
    },
    async changeMasterPassword(currentPassword: string, newPassword: string) {
      validateUnitResponse(await runtime.invoke<unknown>('change_master_password', { currentPassword, newPassword }))
    },
    async deleteSession(sessionId: string) {
      await runtime.invoke('delete_session', { sessionId })
    },
    async deleteGroup(groupId: string) {
      await runtime.invoke('delete_group', { groupId })
    },
    async deleteRule(ruleId: string) {
      await runtime.invoke('delete_rule', { ruleId })
    },
    async createGroup(group: Group) {
      await runtime.invoke('create_group', { group })
    },
    refreshSecretStoreStatus,
    async initializeSecrets(masterPassword: string) {
      const codes = validateRecoveryCodes(await runtime.invoke<unknown>('initialize_secrets', { masterPassword }))
      state.secretStoreConfigured = true
      return codes
    },
    async unlockSecrets(masterPassword: string) {
      const result = await runtime.invoke<unknown>('unlock_secrets', { masterPassword })
      return result === null ? null : validateRecoveryCodes(result)
    },
    async recoverSecrets(recoveryCode: string, newMasterPassword: string) {
      const codes = validateRecoveryCodes(await runtime.invoke<unknown>('recover_secrets', { recoveryCode, newMasterPassword }))
      state.secretStoreConfigured = true
      return codes
    },
    async saveSessionSecret(sessionId: string, secret: string) {
      const config = await runtime.invoke<PersistedConfig>('save_session_secret', { sessionId, secret })
      replaceConfig(config)
    },
    async connectSession(sessionId: string) {
      await runtime.invoke('connect_session', { sessionId })
    },
    async disconnectSession(sessionId: string) {
      await runtime.invoke('disconnect_session', { sessionId })
    },
    async approveHostKey(host: string, port: number, algorithm: string, fingerprint: string) {
      await runtime.invoke('approve_host_key', { host, port, algorithm, fingerprint })
    },
    async startRule(ruleId: string) {
      await runtime.invoke('start_rule', { ruleId })
    },
    async stopRule(ruleId: string) {
      await runtime.invoke('stop_rule', { ruleId })
    },
    async startEnabledRules(sessionId: string) {
      await runtime.invoke('start_enabled_rules', { sessionId })
    },
    async stopSessionRules(sessionId: string) {
      await runtime.invoke('stop_session_rules', { sessionId })
    },
    async exportConfig() {
      return runtime.invoke<string>('export_config')
    },
    async importConfig(json: string, replaceAll: boolean) {
      const config = await runtime.invoke<PersistedConfig>('import_config', { json, replaceAll })
      replaceConfig(config)
    },
  })

  function scheduleReconnect(sessionId: string) {
    if (reconnectingSessions.has(sessionId)) return
    reconnectingSessions.add(sessionId)
    const attempt = reconnectAttempts.get(sessionId) ?? 0
    const delay = Math.min(60, 2 ** attempt) * 1_000
    window.setTimeout(async () => {
      try {
        await runtime.invoke('connect_session', { sessionId })
        await runtime.invoke('start_enabled_rules', { sessionId })
        reconnectAttempts.delete(sessionId)
      } catch {
        reconnectAttempts.set(sessionId, attempt + 1)
        reconnectingSessions.delete(sessionId)
        scheduleReconnect(sessionId)
        return
      }
      reconnectingSessions.delete(sessionId)
    }, delay)
  }
}
