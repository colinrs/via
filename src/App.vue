<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import EmptyWorkspace from './components/EmptyWorkspace.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import CreateGroupDialog from './components/CreateGroupDialog.vue'
import CreateSessionDialog from './components/CreateSessionDialog.vue'
import HostTrustDialog from './components/HostTrustDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import RecoveryCodesDialog from './components/RecoveryCodesDialog.vue'
import SecretSetupDialog from './components/SecretSetupDialog.vue'
import SecretUnlockDialog from './components/SecretUnlockDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SessionSidebar, { type SessionGroup } from './components/SessionSidebar.vue'
import TunnelGrid from './components/TunnelGrid.vue'
import { createI18n, provideI18n, type I18n } from './i18n'
import type { TranslationKey } from './i18n/catalog'
import { applyDocumentPreferences } from './preferences/document'
import { createViaStore, type AppPreferences } from './stores/via'
import type { LocalForwardRule } from './types/via'

const props = defineProps<{ i18n?: I18n }>()
const store = createViaStore()
const i18n = props.i18n ?? createI18n(store.preferences.language)
provideI18n(i18n)
const { t } = i18n
const selectedSessionId = ref<string | null>(null)
const importMode = ref<'import' | 'export' | null>(null)
const unlockOpen = ref(false)
const unlockMode = ref<'unlock' | 'recovery'>('unlock')
const recoveryCodes = ref<string[]>([])
const recoveryCodesAcknowledged = ref(false)
const secretOperationBusy = ref(false)
const credentialOperationMayProduceCodes = ref(false)
type StatusErrorKey = Extract<TranslationKey, `error.${string}`> | 'settings.loadFailed'
const statusError = ref<StatusErrorKey | null>(null)
const settingsOpen = ref(false)
const preferencesReady = ref(false)
const preferences = ref<AppPreferences>({ ...store.preferences })
const preferenceSaving = ref(false)
const preferenceErrorKey = ref<'settings.saveFailed' | null>(null)
const masterPasswordChanging = ref(false)
const masterPasswordErrorKey = ref<'settings.changePasswordFailed' | null>(null)
const masterPasswordChangedToken = ref(0)
let persistedPreferences: AppPreferences = { ...store.preferences }
let preferenceRevision = 0
let queuedPreferenceSaves = 0
let preferenceSaveTail: Promise<void> = Promise.resolve()
let cleanupDocumentPreferences: (() => void) | undefined
let appMounted = false
const exportedJson = ref('')
const hostTrust = ref<{ host: string; port: number; algorithm: string; fingerprint: string } | null>(null)
const deleteSessionOpen = ref(false)
const sessionDeletionBusy = ref(false)
const pendingRuleId = ref<string | null>(null)
const ruleDeletionBusy = ref(false)
const sessionBusy = ref<'connect' | 'disconnect' | 'reconnect' | null>(null)
const bulkRulesBusy = ref(false)
interface GroupDeletionScope {
  id: string
  sessionIds: string[]
  ruleIds: string[]
  scopeChanged: boolean
}
interface PendingGroupDeletion extends GroupDeletionScope {
  generation: number
}
const pendingGroupDeletion = ref<PendingGroupDeletion | null>(null)
const groupDeletionBusy = ref(false)
let groupConfirmationGeneration = 0
const groupConfirmationArmedGeneration = ref<number | null>(null)
const createGroupOpen = ref(false)
const createSessionOpen = ref(false)
const passwordDraft = ref('')
const passphraseDraft = ref('')
const authenticationSaving = ref(false)
const authenticationPicking = ref(false)
const configurationSaving = ref(false)
let privateKeyPickerGeneration = 0
let queuedConfigurationSaves = 0
let configurationSaveTail: Promise<void> = Promise.resolve()

const groups = computed<SessionGroup[]>(() => store.groups.map((group) => ({
  ...group,
  icon: '▣',
  sessions: store.sessions.filter((session) => session.groupId === group.id).map((session) => ({
    id: session.id,
    name: session.name,
    state: store.rules.some((rule) => rule.sessionId === session.id && rule.runtimeState === 'failed') ? 'failed' : store.rules.some((rule) => rule.sessionId === session.id && rule.runtimeState === 'active') ? 'active' : 'stopped',
  })),
})))
const selectedSession = computed(() => store.sessions.find((session) => session.id === selectedSessionId.value))
const currentRules = computed(() => store.rules.filter((rule) => rule.sessionId === selectedSessionId.value))
const activeCount = computed(() => store.rules.filter((rule) => rule.runtimeState === 'active').length)
const errorCount = computed(() => store.rules.filter((rule) => rule.runtimeState === 'conflict' || rule.runtimeState === 'failed').length)
const isConnected = computed(() => !!selectedSessionId.value
  && store.connectedSessionIds.includes(selectedSessionId.value))
const bulkOperationsBusy = computed(() => bulkRulesBusy.value || sessionBusy.value !== null)
const connectHint = computed(() => sessionBusy.value
  ? t('hint.operationInProgress')
  : isConnected.value ? t('hint.sessionConnected') : '')
const disconnectHint = computed(() => sessionBusy.value
  ? t('hint.operationInProgress')
  : !isConnected.value ? t('hint.sessionNotConnected') : '')
const reconnectHint = computed(() => sessionBusy.value ? t('hint.operationInProgress') : '')
const authenticationBusy = computed(() => authenticationSaving.value || authenticationPicking.value)
const authenticationControlsBusy = computed(() => authenticationBusy.value || configurationSaving.value)
const setupOpen = computed(() => preferencesReady.value
  && store.initializationState === 'ready'
  && store.secretStoreConfigured === false)
const workspaceReady = computed(() => store.initializationState === 'ready'
  && preferencesReady.value
  && store.secretStoreConfigured === true
  && recoveryCodes.value.length === 0)
const preferenceErrorMessage = computed(() => preferenceErrorKey.value ? t(preferenceErrorKey.value) : '')
const masterPasswordErrorMessage = computed(() => masterPasswordErrorKey.value ? t(masterPasswordErrorKey.value) : '')
const deleteGroupMessage = computed(() => {
  const pending = pendingGroupDeletion.value
  if (!pending) return ''
  const warning = pending.scopeChanged ? t('dialog.deleteGroup.changed') : ''
  return `${warning}${t('message.deleteGroupScope', { sessions: pending.sessionIds.length, rules: pending.ruleIds.length })}`
})
const backendStatus = computed(() => {
  if (statusError.value) return t(statusError.value)
  if (store.initializationState === 'connecting') return t('status.backendConnecting')
  if (store.initializationState === 'failed') return t('status.backendFailed')
  return t('status.backendReady')
})

function validPreferences(value: unknown): value is AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 3
    && ['system', 'zh-CN', 'en'].includes(candidate.language as string)
    && ['small', 'medium', 'large'].includes(candidate.fontSize as string)
    && ['system', 'light', 'dark'].includes(candidate.theme as string)
}

function applyPreferences(next: AppPreferences) {
  cleanupDocumentPreferences?.()
  preferences.value = { ...next }
  i18n.setLanguage(next.language)
  cleanupDocumentPreferences = applyDocumentPreferences(next, window, document)
}

async function updatePreferences(next: AppPreferences) {
  if (!validPreferences(next)) return
  const revision = ++preferenceRevision
  queuedPreferenceSaves += 1
  preferenceSaving.value = true
  preferenceErrorKey.value = null
  applyPreferences(next)

  const operation = preferenceSaveTail.then(async () => {
    try {
      await store.savePreferences(next)
      persistedPreferences = { ...next }
      if (revision === preferenceRevision && appMounted) {
        preferenceErrorKey.value = null
        if (statusError.value === 'settings.loadFailed') statusError.value = null
      }
    } catch {
      if (revision === preferenceRevision && appMounted) {
        applyPreferences(persistedPreferences)
        preferenceErrorKey.value = 'settings.saveFailed'
      }
    }
  })
  preferenceSaveTail = operation
  await operation
  queuedPreferenceSaves -= 1
  if (queuedPreferenceSaves === 0) preferenceSaving.value = false
}

function openSettings() {
  if (!workspaceReady.value) return
  preferenceErrorKey.value = null
  masterPasswordErrorKey.value = null
  settingsOpen.value = true
}

function closeSettings() {
  settingsOpen.value = false
  preferenceErrorKey.value = null
  masterPasswordErrorKey.value = null
}

async function changeMasterPassword(currentPassword: string, newPassword: string) {
  if (masterPasswordChanging.value
    || !settingsOpen.value
    || store.secretStoreConfigured !== true
    || !currentPassword.trim()
    || !newPassword.trim()) return
  masterPasswordChanging.value = true
  masterPasswordErrorKey.value = null
  try {
    await store.changeMasterPassword(currentPassword, newPassword)
    masterPasswordChangedToken.value += 1
  } catch {
    masterPasswordErrorKey.value = 'settings.changePasswordFailed'
  } finally {
    masterPasswordChanging.value = false
  }
}

async function saveConfig() {
  queuedConfigurationSaves += 1
  configurationSaving.value = true
  let succeeded = false
  const operation = configurationSaveTail.then(async () => {
    try { await store.save(); statusError.value = null; succeeded = true } catch { statusError.value = 'error.saveConfig' }
  })
  configurationSaveTail = operation
  await operation
  queuedConfigurationSaves -= 1
  if (queuedConfigurationSaves === 0) configurationSaving.value = false
  return succeeded
}
async function persist() {
  if (authenticationBusy.value) return false
  return saveConfig()
}
function clearAuthenticationDrafts() {
  passwordDraft.value = ''
  passphraseDraft.value = ''
}
async function changeAuthenticationKind(event: Event) {
  if (authenticationControlsBusy.value) return
  const session = selectedSession.value
  const kind = (event.target as HTMLSelectElement).value
  if (!session || (kind !== 'password' && kind !== 'private_key') || kind === session.auth.kind) return
  clearAuthenticationDrafts()
  session.auth = kind === 'password'
    ? { kind: 'password', secretId: null }
    : { kind: 'private_key', path: '', passphraseSecretId: null }
  await persist()
}
async function choosePrivateKey() {
  if (authenticationControlsBusy.value) return
  const sessionId = selectedSessionId.value
  const auth = selectedSession.value?.auth
  if (!sessionId || auth?.kind !== 'private_key') return
  const generation = ++privateKeyPickerGeneration
  authenticationPicking.value = true
  try {
    const path = await open({ multiple: false, directory: false })
    if (generation !== privateKeyPickerGeneration || typeof path !== 'string' || selectedSessionId.value !== sessionId) return
    const session = store.sessions.find((item) => item.id === sessionId)
    if (session?.auth !== auth || session.auth.kind !== 'private_key') return
    const previousPath = auth.path
    session.auth.path = path
    if (!(await saveConfig())) {
      const originatingSession = store.sessions.find((item) => item.id === sessionId)
      if (originatingSession?.auth === auth && originatingSession.auth.kind === 'private_key') originatingSession.auth.path = previousPath
    }
  } catch {
    statusError.value = 'error.choosePrivateKey'
  } finally {
    authenticationPicking.value = false
  }
}
async function saveAuthentication() {
  if (authenticationControlsBusy.value) return
  const session = selectedSession.value
  if (!session) return
  const sessionId = session.id
  const authKind = session.auth.kind
  const draft = session.auth.kind === 'password' ? passwordDraft : passphraseDraft
  const secret = draft.value
  authenticationSaving.value = true
  try {
    if (!(await saveConfig())) {
      statusError.value = 'error.saveAuthenticationConfig'
      return
    }
    const persistedSession = store.sessions.find((item) => item.id === sessionId)
    if (persistedSession?.auth.kind !== authKind) return
    if (!secret.trim()) {
      if (selectedSessionId.value === sessionId && selectedSession.value?.auth.kind === authKind && draft.value === secret) draft.value = ''
      return
    }
    await store.saveSessionSecret(sessionId, secret)
    if (selectedSessionId.value === sessionId && selectedSession.value?.auth.kind === authKind && draft.value === secret) draft.value = ''
    statusError.value = null
  } catch {
    statusError.value = 'error.saveAuthenticationCredentials'
  } finally {
    authenticationSaving.value = false
  }
}
async function updateRule(nextRule: LocalForwardRule) { const index = store.rules.findIndex((rule) => rule.id === nextRule.id); if (index >= 0) store.rules.splice(index, 1, nextRule); await persist() }
async function toggleRule(nextRule: LocalForwardRule) { await updateRule(nextRule); try { if (nextRule.enabled) await store.startRule(nextRule.id); else await store.stopRule(nextRule.id) } catch { statusError.value = 'error.ruleOperation' } }
async function addRule() { if (!selectedSessionId.value) return; store.rules.push({ id: crypto.randomUUID(), sessionId: selectedSessionId.value, enabled: false, localPort: 1, targetHost: 'localhost', targetPort: 1, note: '', runtimeState: 'stopped' }); await persist() }
async function cloneRule(id: string) { const source = store.rules.find((rule) => rule.id === id); if (source) { store.rules.push({ ...source, id: crypto.randomUUID(), localPort: 1, runtimeState: 'stopped', enabled: false }); await persist() } }
function requestRemoveRule(id: string) { pendingRuleId.value = id }
function closeRuleDeletion() { if (!ruleDeletionBusy.value) pendingRuleId.value = null }
async function removeRule() {
  if (ruleDeletionBusy.value) return
  const id = pendingRuleId.value
  if (!id) return
  const rule = store.rules.find((item) => item.id === id)
  if (!rule) { pendingRuleId.value = null; return }
  ruleDeletionBusy.value = true
  try {
    if (rule.runtimeState !== 'stopped') await store.stopRule(id).catch(() => undefined)
    await store.deleteRule(id)
    const index = store.rules.findIndex((item) => item.id === id)
    if (index >= 0) store.rules.splice(index, 1)
    pendingRuleId.value = null
    statusError.value = null
  } catch {
    await store.reloadConfig().catch(() => undefined)
    if (!store.rules.some((item) => item.id === id)) pendingRuleId.value = null
    if (!store.sessions.some((session) => session.id === selectedSessionId.value)) selectedSessionId.value = store.sessions[0]?.id ?? null
    statusError.value = 'error.deleteRule'
  } finally {
    ruleDeletionBusy.value = false
  }
}
function applyConnectFailure(error: unknown) {
  const value = String(error)
  hostTrust.value = hostTrustRequest(value)
  statusError.value = hostTrust.value ? null : value.includes('HostKeyChanged') ? 'error.hostKeyChanged' : 'error.connect'
}
async function connect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'connect'
  try {
    await store.connectSession(selectedSessionId.value)
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch (error) {
    applyConnectFailure(error)
  } finally {
    sessionBusy.value = null
  }
}
async function disconnect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'disconnect'
  try {
    await store.disconnectSession(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.disconnect'
  } finally {
    sessionBusy.value = null
  }
}
async function reconnect() {
  if (!selectedSessionId.value || sessionBusy.value) return
  sessionBusy.value = 'reconnect'
  try {
    await store.disconnectSession(selectedSessionId.value)
    await store.connectSession(selectedSessionId.value)
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch (error) {
    applyConnectFailure(error)
  } finally {
    sessionBusy.value = null
  }
}
async function startAll() {
  if (!selectedSessionId.value || bulkRulesBusy.value) return
  bulkRulesBusy.value = true
  try {
    await store.startEnabledRules(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.ruleOperation'
  } finally {
    bulkRulesBusy.value = false
  }
}
async function stopAll() {
  if (!selectedSessionId.value || bulkRulesBusy.value) return
  bulkRulesBusy.value = true
  try {
    await store.stopSessionRules(selectedSessionId.value)
    statusError.value = null
  } catch {
    statusError.value = 'error.ruleOperation'
  } finally {
    bulkRulesBusy.value = false
  }
}
function hostTrustRequest(value: string) {
  const match = /HostTrustRequired \{ host: "([^"]+)", port: (\d+), algorithm: "([^"]+)", fingerprint: "([^"]+)" \}/.exec(value)
  return match ? { host: match[1], port: Number(match[2]), algorithm: match[3], fingerprint: match[4] } : null
}
async function approveHostTrust() { if (!hostTrust.value) return; const request = hostTrust.value; try { await store.approveHostKey(request.host, request.port, request.algorithm, request.fingerprint); hostTrust.value = null; await connect() } catch { statusError.value = 'error.saveHostTrust' } }
async function initializeSecrets(password: string) {
  if (secretOperationBusy.value || !setupOpen.value || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  credentialOperationMayProduceCodes.value = true
  try {
    recoveryCodes.value = await store.initializeSecrets(password)
    recoveryCodesAcknowledged.value = false
    statusError.value = null
  } catch {
    statusError.value = 'error.initializeCredentials'
  } finally {
    credentialOperationMayProduceCodes.value = false
    secretOperationBusy.value = false
  }
}
async function unlock(password: string) {
  if (secretOperationBusy.value || !unlockOpen.value || unlockMode.value !== 'unlock' || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  credentialOperationMayProduceCodes.value = true
  try {
    const codes = await store.unlockSecrets(password)
    unlockOpen.value = false
    unlockMode.value = 'unlock'
    recoveryCodes.value = codes ?? []
    recoveryCodesAcknowledged.value = false
    statusError.value = null
  } catch {
    statusError.value = 'error.unlockCredentials'
  } finally {
    credentialOperationMayProduceCodes.value = false
    secretOperationBusy.value = false
  }
}
async function recover(code: string, password: string) {
  if (secretOperationBusy.value || !unlockOpen.value || unlockMode.value !== 'recovery' || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  credentialOperationMayProduceCodes.value = true
  try {
    const codes = await store.recoverSecrets(code, password)
    unlockOpen.value = false
    unlockMode.value = 'unlock'
    recoveryCodes.value = codes
    recoveryCodesAcknowledged.value = false
    statusError.value = null
  } catch {
    statusError.value = 'error.recoverCredentials'
  } finally {
    credentialOperationMayProduceCodes.value = false
    secretOperationBusy.value = false
  }
}
function openUnlock() {
  if (!workspaceReady.value) return
  unlockMode.value = 'unlock'
  unlockOpen.value = true
}
function changeUnlockMode(mode: 'unlock' | 'recovery') {
  if (!secretOperationBusy.value && unlockOpen.value && recoveryCodes.value.length === 0) unlockMode.value = mode
}
function closeUnlock() {
  if (secretOperationBusy.value) return
  unlockOpen.value = false
  unlockMode.value = 'unlock'
}
function acknowledgeRecoveryCodes(acknowledged: unknown) {
  if (acknowledged !== true || recoveryCodes.value.length === 0) return
  recoveryCodesAcknowledged.value = true
  recoveryCodes.value = []
  recoveryCodesAcknowledged.value = false
}
function warnBeforeClosingWithCodes(event: BeforeUnloadEvent) {
  if (!credentialOperationMayProduceCodes.value && recoveryCodes.value.length === 0) return
  event.preventDefault()
  event.returnValue = ''
}
async function openTransfer(mode: 'import' | 'export') { try { exportedJson.value = mode === 'export' ? await store.exportConfig() : ''; importMode.value = mode } catch { statusError.value = 'error.readConfig' } }
async function transfer(json: string, replaceAll: boolean) { try { if (importMode.value === 'export') await navigator.clipboard.writeText(json); else { await store.importConfig(json, replaceAll); selectedSessionId.value = store.sessions[0]?.id ?? null }; importMode.value = null } catch { statusError.value = 'error.processConfig' } }
function requestCreateSession() { if (store.groups.length) createSessionOpen.value = true; else void addSession() }
async function addSession(groupId?: string) { const group = store.groups.find((item) => item.id === groupId) ?? store.groups[0] ?? { id: crypto.randomUUID(), name: t('message.defaultGroup') }; if (!store.groups.length) store.groups.push(group); const id = crypto.randomUUID(); store.sessions.push({ id, groupId: group.id, name: t('message.unnamedSession'), host: 'localhost', port: 22, user: 'root', auth: { kind: 'password', secretId: null } }); selectedSessionId.value = id; createSessionOpen.value = false; await persist() }
async function createGroup(name: string) { const group = { id: crypto.randomUUID(), name }; store.groups.push(group); try { await store.createGroup(group); createGroupOpen.value = false; statusError.value = null } catch { store.groups.splice(store.groups.findIndex((item) => item.id === group.id), 1); statusError.value = 'error.createGroup' } }
function groupDeletionSignature(id: string): GroupDeletionScope {
  const sessionIds = store.sessions
    .filter((session) => session.groupId === id)
    .map((session) => session.id)
    .sort()
  const affectedSessionIds = new Set(sessionIds)
  return {
    id,
    sessionIds,
    ruleIds: store.rules
      .filter((rule) => affectedSessionIds.has(rule.sessionId))
      .map((rule) => rule.id)
      .sort(),
    scopeChanged: false,
  }
}
function sameGroupDeletionScope(left: GroupDeletionScope, right: GroupDeletionScope) {
  return left.id === right.id
    && left.sessionIds.length === right.sessionIds.length
    && left.ruleIds.length === right.ruleIds.length
    && left.sessionIds.every((id, index) => id === right.sessionIds[index])
    && left.ruleIds.every((id, index) => id === right.ruleIds[index])
}
function requestRemoveGroup(id: string) {
  groupConfirmationArmedGeneration.value = null
  groupConfirmationGeneration += 1
  pendingGroupDeletion.value = { ...groupDeletionSignature(id), generation: groupConfirmationGeneration }
}
function armGroupDeletionConfirmation(generation: number) {
  if (generation === pendingGroupDeletion.value?.generation) {
    groupConfirmationArmedGeneration.value = generation
  }
}
function closeGroupDeletion() {
  if (!groupDeletionBusy.value) {
    groupConfirmationArmedGeneration.value = null
    pendingGroupDeletion.value = null
  }
}
async function removeGroup(generation: number) {
  if (groupDeletionBusy.value) return
  const pending = pendingGroupDeletion.value
  if (!pending || generation !== pending.generation || groupConfirmationArmedGeneration.value !== generation) return
  const current = groupDeletionSignature(pending.id)
  if (!sameGroupDeletionScope(pending, current)) {
    groupConfirmationArmedGeneration.value = null
    groupConfirmationGeneration += 1
    pendingGroupDeletion.value = { ...current, scopeChanged: true, generation: groupConfirmationGeneration }
    return
  }
  groupDeletionBusy.value = true
  const affectedSessionIds = new Set(pending.sessionIds)
  try {
    await Promise.all(pending.sessionIds.map((id) => store.disconnectSession(id).catch(() => undefined)))
    await store.deleteGroup(pending.id)
    store.rules.splice(0, store.rules.length, ...store.rules.filter((rule) => !affectedSessionIds.has(rule.sessionId)))
    store.sessions.splice(0, store.sessions.length, ...store.sessions.filter((session) => session.groupId !== pending.id))
    const groupIndex = store.groups.findIndex((group) => group.id === pending.id)
    if (groupIndex >= 0) store.groups.splice(groupIndex, 1)
    selectedSessionId.value = store.sessions[0]?.id ?? null
    pendingGroupDeletion.value = null
    statusError.value = null
  } catch {
    await store.reloadConfig().catch(() => undefined)
    if (!store.groups.some((group) => group.id === pending.id)) pendingGroupDeletion.value = null
    if (!store.sessions.some((session) => session.id === selectedSessionId.value)) selectedSessionId.value = store.sessions[0]?.id ?? null
    statusError.value = 'error.deleteGroup'
  } finally {
    groupDeletionBusy.value = false
  }
}
function requestRemoveSession() { if (selectedSessionId.value) deleteSessionOpen.value = true }
function closeSessionDeletion() { if (!sessionDeletionBusy.value) deleteSessionOpen.value = false }
async function removeSession() {
  if (sessionDeletionBusy.value) return
  if (!selectedSessionId.value) return
  const id = selectedSessionId.value
  sessionDeletionBusy.value = true
  // Runtime cleanup must not make an otherwise valid SQLite deletion fail.
  await store.disconnectSession(id).catch(() => undefined)
  const previousSessions = [...store.sessions]
  const previousRules = [...store.rules]
  try {
    await store.deleteSession(id)
    store.rules.splice(0, store.rules.length, ...store.rules.filter((rule) => rule.sessionId !== id))
    const index = store.sessions.findIndex((session) => session.id === id)
    if (index >= 0) store.sessions.splice(index, 1)
    selectedSessionId.value = store.sessions[0]?.id ?? null
    deleteSessionOpen.value = false
    statusError.value = null
  } catch {
    store.sessions.splice(0, store.sessions.length, ...previousSessions)
    store.rules.splice(0, store.rules.length, ...previousRules)
    selectedSessionId.value = id
    statusError.value = 'error.deleteSession'
  } finally {
    sessionDeletionBusy.value = false
  }
}

watch(selectedSessionId, () => {
  privateKeyPickerGeneration += 1
  clearAuthenticationDrafts()
})
onMounted(async () => {
  appMounted = true
  window.addEventListener('beforeunload', warnBeforeClosingWithCodes)
  try {
    await store.initialize()
    if (!appMounted) return
    selectedSessionId.value = store.sessions[0]?.id ?? null
    try {
      await store.loadPreferences()
      if (!appMounted) return
      persistedPreferences = { ...store.preferences }
    } catch {
      if (!appMounted) return
      statusError.value = 'settings.loadFailed'
    }
    if (!appMounted) return
    applyPreferences(persistedPreferences)
    preferencesReady.value = true
  } catch {}
})
onBeforeUnmount(() => {
  appMounted = false
  cleanupDocumentPreferences?.()
  window.removeEventListener('beforeunload', warnBeforeClosingWithCodes)
})
</script>

<template>
  <main data-testid="via-app" class="via-app">
    <fieldset data-testid="app-interactions" class="app-interactions" :disabled="authenticationBusy || secretOperationBusy">
    <header class="titlebar">
      <div class="brand"><span class="mark">V</span><span>Via</span><span class="version">{{ t('app.mvpVersion') }}</span></div>
      <div v-if="workspaceReady" class="title-actions"><button type="button" @click="openTransfer('import')">{{ t('action.importConfig') }}</button><button type="button" @click="openTransfer('export')">{{ t('action.exportConfig') }}</button><button type="button" @click="openUnlock">{{ t('action.unlockCredentials') }}</button><button type="button" :aria-label="t('app.settings')" @click="openSettings">⚙ {{ t('app.settings') }}</button></div>
    </header>
    <div v-if="workspaceReady" class="workspace">
      <SessionSidebar :groups="groups" :selected-session-id="selectedSessionId ?? ''" @select="selectedSessionId = $event" @create="requestCreateSession" @create-group="createGroupOpen=true" @delete-group="requestRemoveGroup" />
      <section v-if="selectedSession" class="content">
        <header class="session-header">
          <div><p class="section-label">{{ t('title.session') }}</p><h1>{{ selectedSession.name }}</h1><p class="connection"><span class="session-dot" :class="{ connected: isConnected }" />{{ selectedSession.user }}@{{ selectedSession.host || t('message.unconfiguredHost') }}:{{ selectedSession.port }}<span class="connection-state" :class="{ connected: isConnected }">{{ t(isConnected ? 'state.connected' : 'state.disconnected') }}</span></p></div>
          <div class="header-actions"><span class="button-wrap" :title="connectHint || undefined"><button class="success-button" type="button" :aria-description="connectHint || undefined" :disabled="sessionBusy !== null || isConnected" @click="connect">{{ sessionBusy === 'connect' ? t('common.inProgress', { action: t('action.connectAndStart') }) : t('action.connectAndStart') }}</button></span><span class="button-wrap" :title="disconnectHint || undefined"><button class="danger-button" type="button" :aria-description="disconnectHint || undefined" :disabled="sessionBusy !== null || !isConnected" @click="disconnect">{{ sessionBusy === 'disconnect' ? t('common.inProgress', { action: t('action.disconnect') }) : t('action.disconnect') }}</button></span><span class="button-wrap" :title="reconnectHint || undefined"><button class="secondary-button" type="button" :aria-description="reconnectHint || undefined" :disabled="sessionBusy !== null" @click="reconnect">{{ sessionBusy === 'reconnect' ? t('common.inProgress', { action: t('action.reconnectTunnels') }) : t('action.reconnectTunnels') }}</button></span><button class="danger-button" type="button" @click="requestRemoveSession">{{ t('action.deleteSession') }}</button></div>
        </header>
        <TunnelGrid :rules="currentRules" :bulk-busy="bulkOperationsBusy" :session-connected="isConnected" @add="addRule" @update="updateRule" @toggle="toggleRule" @remove="requestRemoveRule" @clone="cloneRule" @start-all="startAll" @stop-all="stopAll" />
        <section class="session-editor">
          <div class="editor-title"><span aria-hidden="true">▤</span> {{ t('title.currentSessionConfig') }}</div>
          <div class="editor-fields">
            <label>{{ t('field.sessionName') }}<input v-model="selectedSession.name" :aria-label="t('field.sessionName')" @change="persist" /></label>
            <label>{{ t('field.hostAddress') }}<input v-model="selectedSession.host" :aria-label="t('field.hostAddress')" @change="persist" /></label>
            <label>{{ t('field.sshPort') }}<input v-model.number="selectedSession.port" type="number" :aria-label="t('field.sshPort')" @change="persist" /></label>
            <label>{{ t('field.loginUser') }}<input v-model="selectedSession.user" :aria-label="t('field.loginUser')" @change="persist" /></label>
            <label>{{ t('field.authentication') }}<select :value="selectedSession.auth.kind" :aria-label="t('field.authentication')" :disabled="authenticationControlsBusy" @change="changeAuthenticationKind"><option value="password">{{ t('field.password') }}</option><option value="private_key">{{ t('field.privateKey') }}</option></select></label>
            <template v-if="selectedSession.auth.kind === 'password'">
              <label class="authentication-field">{{ t('field.sshPassword') }}<input v-model="passwordDraft" :aria-label="t('field.sshPassword')" type="password" autocomplete="new-password" /></label>
            </template>
            <template v-else>
              <label class="authentication-field">{{ t('field.privateKeyFile') }}<input v-model="selectedSession.auth.path" :aria-label="t('field.privateKeyFile')" @change="persist" /></label>
              <button data-testid="choose-private-key" class="secondary-button" type="button" :disabled="authenticationControlsBusy" @click="choosePrivateKey">{{ t('action.choosePrivateKey') }}</button>
              <label class="authentication-field">{{ t('field.privateKeyPassphrase') }}<input v-model="passphraseDraft" :aria-label="t('field.privateKeyPassphrase')" type="password" autocomplete="new-password" /></label>
            </template>
            <button data-testid="save-authentication" class="primary-button" type="button" :disabled="authenticationControlsBusy" @click="saveAuthentication">{{ t('action.saveAuthentication') }}</button>
          </div>
        </section>
      </section>
      <EmptyWorkspace v-else @create="requestCreateSession" />
    </div>
    <footer class="statusbar"><span><i class="live-dot" />{{ backendStatus }}</span><span>{{ t('status.tunnels', { active: activeCount, errors: errorCount }) }}</span></footer>
    <ImportDialog :open="importMode!==null" :mode="importMode ?? 'import'" :export-json="exportedJson" @close="importMode=null" @confirm="transfer" />
    <SecretSetupDialog :open="setupOpen" @setup="initializeSecrets" />
    <SecretUnlockDialog :open="unlockOpen" @close="closeUnlock" @unlock="unlock" @recover="recover" @mode-change="changeUnlockMode" />
    <RecoveryCodesDialog :open="recoveryCodes.length > 0" :codes="recoveryCodes" @acknowledge="acknowledgeRecoveryCodes" />
    <HostTrustDialog :open="hostTrust!==null" :host="hostTrust?.host ?? ''" :port="hostTrust?.port ?? 22" :algorithm="hostTrust?.algorithm ?? ''" :fingerprint="hostTrust?.fingerprint ?? ''" @close="hostTrust=null" @approve="approveHostTrust" />
    <ConfirmDialog :open="deleteSessionOpen" :busy="sessionDeletionBusy" :title="t('dialog.deleteSession.title')" :message="t('dialog.deleteSession.message')" :confirm-text="t('action.deleteSession')" @close="closeSessionDeletion" @confirm="removeSession" />
    <ConfirmDialog :open="pendingRuleId!==null" :busy="ruleDeletionBusy" :title="t('dialog.deleteRule.title')" :message="t('dialog.deleteRule.message')" :confirm-text="t('action.deleteRule')" @close="closeRuleDeletion" @confirm="removeRule" />
    <ConfirmDialog :key="pendingGroupDeletion?.generation ?? 0" :generation="pendingGroupDeletion?.generation ?? 0" :open="pendingGroupDeletion!==null" :busy="groupDeletionBusy" :title="t('dialog.deleteGroup.title')" :message="deleteGroupMessage" :confirm-text="t('sidebar.deleteGroup')" @close="closeGroupDeletion" @confirm="removeGroup" @ready="armGroupDeletionConfirmation" />
    <CreateGroupDialog :open="createGroupOpen" @close="createGroupOpen=false" @create="createGroup" />
    <CreateSessionDialog :open="createSessionOpen" :groups="store.groups" @close="createSessionOpen=false" @create="addSession" />
    <SettingsDialog :open="settingsOpen" :preferences="preferences" :saving="preferenceSaving" :preferences-error="preferenceErrorMessage" :master-password-changing="masterPasswordChanging" :master-password-configured="store.secretStoreConfigured === true" :master-password-error="masterPasswordErrorMessage" :master-password-changed-token="masterPasswordChangedToken" @update-preferences="updatePreferences" @change-master-password="changeMasterPassword" @close="closeSettings" />
    </fieldset>
  </main>
</template>

<style>
:root { color: #e6edf3; background: #0d1117; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --canvas: #0d1117; --surface: #161b22; --surface-raised: #21262d; --line: #30363d; --text: #e6edf3; --muted: #8b949e; --blue: #388bfd; --green: #3fb950; --red: #f85149; --yellow: #d29922; } * { box-sizing: border-box; } body { margin: 0; min-width: 980px; } button,input,select { font: inherit; } .via-app { display: flex; min-height: 100vh; flex-direction: column; background: var(--canvas); }.app-interactions { display: flex; min-width: 0; min-height: 100vh; flex: 1; flex-direction: column; margin: 0; border: 0; padding: 0; }.titlebar { display: flex; height: 48px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 0 17px; }.brand,.title-actions,.header-actions { display: flex; align-items: center; gap: 10px; }.button-wrap { display: inline-flex; }.brand { font-size: 14px; font-weight: 750; }.mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 6px; background: var(--blue); color: white; font-size: 12px; }.version { border: 1px solid rgb(56 139 253 / 35%); border-radius: 4px; background: rgb(56 139 253 / 10%); padding: 2px 5px; color: #79c0ff; font-size: 10px; font-weight: 600; }.title-actions button,.secondary-button,.success-button,.danger-button { border: 1px solid var(--line); border-radius: 6px; background: var(--surface-raised); padding: 7px 10px; color: var(--text); font-size: 12px; cursor: pointer; }.title-actions button:hover,.secondary-button:hover { border-color: var(--muted); }.primary-button { border: 1px solid #4696fa; border-radius: 6px; background: #1f6feb; padding: 7px 10px; color: white; font-size: 12px; font-weight: 650; cursor: pointer; }.primary-button:hover { background: #388bfd; }.success-button { border-color: rgb(63 185 80 / 35%); background: rgb(63 185 80 / 10%); color: #56d364; }.danger-button { border-color: rgb(248 81 73 / 35%); background: rgb(248 81 73 / 8%); color: #ff7b72; }.workspace { display: flex; min-height: 0; flex: 1; }.content { display: flex; min-width: 0; flex: 1; flex-direction: column; }.session-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 17px 20px; }.section-label { margin: 0 0 4px; color: var(--blue); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }.session-header h1 { margin: 0; font-size: 16px; }.connection { display: flex; align-items: center; gap: 6px; margin: 5px 0 0; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }.live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 7px var(--green); }.connected { color: #56d364; font-size: 12px; }.session-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }.session-dot.connected { background: var(--green); box-shadow: 0 0 7px var(--green); }.connection-state { margin-left: 8px; color: var(--muted); }.connection-state.connected { color: var(--green); }button:disabled { opacity: .55; cursor: not-allowed; }.session-editor { border-top: 1px solid var(--line); background: var(--surface); padding: 14px 20px 17px; }.editor-title { margin-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 700; }.editor-fields { display: grid; grid-template-columns: 1fr 1.3fr 90px 1fr 1.5fr; gap: 12px; }.editor-fields label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }.editor-fields input,.editor-fields select { min-width: 0; border: 1px solid var(--line); border-radius: 5px; outline: 0; background: var(--canvas); padding: 7px 8px; color: var(--text); font-size: 12px; }.editor-fields input:focus,.editor-fields select:focus { border-color: var(--blue); }.editor-fields > button { align-self: end; }.statusbar { display: flex; height: 26px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 0 17px; color: var(--muted); font-size: 11px; }.statusbar span { display: flex; align-items: center; gap: 6px; } @media (max-width: 1100px) { .editor-fields { grid-template-columns: repeat(2, 1fr); }.key-path { grid-column: span 2; } }
</style>
