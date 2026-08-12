import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { Group, LocalForwardRule, SessionConfig, TunnelState } from '../types/via'

export interface ViaBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>
}

export interface RuntimeSnapshot {
  rules: Array<{ ruleId: string; state: TunnelState; message: string | null }>
}

export interface PersistedConfig {
  schemaVersion: number
  groups: Group[]
  sessions: SessionConfig[]
  rules: LocalForwardRule[]
}

export type InitializationState = 'idle' | 'connecting' | 'ready' | 'failed'

export interface ViaStore {
  groups: Group[]
  sessions: SessionConfig[]
  rules: LocalForwardRule[]
  initialized: boolean
  initializationState: InitializationState
  initialize(): Promise<void>
  save(): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  createGroup(group: Group): Promise<void>
  unlockSecrets(masterPassword: string): Promise<void>
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
    initialized: false,
    initializationState: 'idle' as InitializationState,
  })
  let unsubscribe: (() => void) | undefined
  const reconnectAttempts = new Map<string, number>()
  const reconnectingSessions = new Set<string>()

  const replace = (target: unknown[], values: unknown[]) => target.splice(0, target.length, ...values)
  const snapshot = (): PersistedConfig => ({ schemaVersion: 1, groups: state.groups, sessions: state.sessions, rules: state.rules })

  return Object.assign(state, {
    async initialize() {
      state.initializationState = 'connecting'
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
      if (!config) {
        state.initializationState = 'failed'
        throw lastError
      }
      replace(state.groups, config.groups)
      replace(state.sessions, config.sessions)
      replace(state.rules, config.rules)
      if (!unsubscribe) {
        unsubscribe = await runtime.listen<RuntimeSnapshot>('runtime-state', (runtime) => {
          for (const update of runtime.rules) {
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
    },
    async save() {
      await runtime.invoke('save_config', { config: snapshot() })
    },
    async deleteSession(sessionId: string) {
      await runtime.invoke('delete_session', { sessionId })
    },
    async createGroup(group: Group) {
      await runtime.invoke('create_group', { group })
    },
    async unlockSecrets(masterPassword: string) {
      await runtime.invoke('unlock_secrets', { masterPassword })
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
      replace(state.groups, config.groups)
      replace(state.sessions, config.sessions)
      replace(state.rules, config.rules)
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
