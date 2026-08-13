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
import SessionSidebar, { type SessionGroup } from './components/SessionSidebar.vue'
import TunnelGrid from './components/TunnelGrid.vue'
import { createViaStore } from './stores/via'
import type { LocalForwardRule } from './types/via'

const store = createViaStore()
const selectedSessionId = ref<string | null>(null)
const importMode = ref<'import' | 'export' | null>(null)
const unlockOpen = ref(false)
const unlockMode = ref<'unlock' | 'recovery'>('unlock')
const recoveryCodes = ref<string[]>([])
const recoveryCodesAcknowledged = ref(false)
const secretOperationBusy = ref(false)
const statusError = ref('')
const exportedJson = ref('')
const hostTrust = ref<{ host: string; port: number; algorithm: string; fingerprint: string } | null>(null)
const deleteSessionOpen = ref(false)
const sessionDeletionBusy = ref(false)
const pendingRuleId = ref<string | null>(null)
const ruleDeletionBusy = ref(false)
const pendingGroupDeletion = ref<{ id: string; sessionIds: string[]; ruleCount: number } | null>(null)
const groupDeletionBusy = ref(false)
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
const authenticationBusy = computed(() => authenticationSaving.value || authenticationPicking.value)
const authenticationControlsBusy = computed(() => authenticationBusy.value || configurationSaving.value)
const setupOpen = computed(() => store.initializationState === 'ready' && store.secretStoreConfigured === false)
const workspaceReady = computed(() => store.initializationState === 'ready'
  && store.secretStoreConfigured === true
  && recoveryCodes.value.length === 0)
const deleteGroupMessage = computed(() => {
  const pending = pendingGroupDeletion.value
  if (!pending) return ''
  return `将删除此分组下的 ${pending.sessionIds.length} 个会话和 ${pending.ruleCount} 条转发规则，此操作不可撤销。`
})
const backendStatus = computed(() => {
  if (statusError.value) return statusError.value
  if (store.initializationState === 'connecting') return '正在连接本地后端…'
  if (store.initializationState === 'failed') return '无法连接本地后端'
  return 'Rust backend: SQLite local mode'
})

async function saveConfig() {
  queuedConfigurationSaves += 1
  configurationSaving.value = true
  let succeeded = false
  const operation = configurationSaveTail.then(async () => {
    try { await store.save(); statusError.value = ''; succeeded = true } catch { statusError.value = '保存失败，请检查会话和规则填写是否完整。' }
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
    statusError.value = '选择私钥文件失败，请重试。'
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
      statusError.value = '保存认证配置失败，请重试。'
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
    statusError.value = ''
  } catch {
    statusError.value = '保存认证凭据失败，请重试。'
  } finally {
    authenticationSaving.value = false
  }
}
async function updateRule(nextRule: LocalForwardRule) { const index = store.rules.findIndex((rule) => rule.id === nextRule.id); if (index >= 0) store.rules.splice(index, 1, nextRule); await persist() }
async function toggleRule(nextRule: LocalForwardRule) { await updateRule(nextRule); try { if (nextRule.enabled) await store.startRule(nextRule.id); else await store.stopRule(nextRule.id) } catch { statusError.value = '规则操作失败：请先连接 SSH 会话并检查端口。' } }
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
    statusError.value = ''
  } catch {
    statusError.value = '删除规则失败，请重试。'
  } finally {
    ruleDeletionBusy.value = false
  }
}
async function startAll() { if (selectedSessionId.value) await store.startEnabledRules(selectedSessionId.value) }
async function stopAll() { if (selectedSessionId.value) await store.stopSessionRules(selectedSessionId.value) }
function hostTrustRequest(error: unknown) {
  const value = String(error)
  const match = /HostTrustRequired \{ host: "([^"]+)", port: (\d+), algorithm: "([^"]+)", fingerprint: "([^"]+)" \}/.exec(value)
  return match ? { host: match[1], port: Number(match[2]), algorithm: match[3], fingerprint: match[4] } : null
}
async function connect() { if (!selectedSessionId.value) return; try { await store.connectSession(selectedSessionId.value); await startAll() } catch (error) { hostTrust.value = hostTrustRequest(error); const value = String(error); statusError.value = hostTrust.value ? '' : value.includes('HostKeyChanged') ? '主机密钥已变化，连接已阻断。请核对旧/新 SHA-256 指纹后更新受信任主机。' : '连接失败：请解锁凭据或检查主机指纹与网络。' } }
async function approveHostTrust() { if (!hostTrust.value) return; const request = hostTrust.value; try { await store.approveHostKey(request.host, request.port, request.algorithm, request.fingerprint); hostTrust.value = null; await connect() } catch { statusError.value = '无法保存主机信任记录。' } }
async function disconnect() { if (selectedSessionId.value) await store.disconnectSession(selectedSessionId.value) }
async function initializeSecrets(password: string) {
  if (secretOperationBusy.value || !setupOpen.value || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  try {
    recoveryCodes.value = await store.initializeSecrets(password)
    recoveryCodesAcknowledged.value = false
    statusError.value = ''
  } catch {
    statusError.value = '初始化本地凭据失败，请重试。'
  } finally {
    secretOperationBusy.value = false
  }
}
async function unlock(password: string) {
  if (secretOperationBusy.value || !unlockOpen.value || unlockMode.value !== 'unlock' || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  try {
    const codes = await store.unlockSecrets(password)
    unlockOpen.value = false
    unlockMode.value = 'unlock'
    recoveryCodes.value = codes ?? []
    recoveryCodesAcknowledged.value = false
    statusError.value = ''
  } catch {
    statusError.value = '主密码不正确，无法解锁本地凭据。'
  } finally {
    secretOperationBusy.value = false
  }
}
async function recover(code: string, password: string) {
  if (secretOperationBusy.value || !unlockOpen.value || unlockMode.value !== 'recovery' || recoveryCodes.value.length > 0) return
  secretOperationBusy.value = true
  try {
    const codes = await store.recoverSecrets(code, password)
    unlockOpen.value = false
    unlockMode.value = 'unlock'
    recoveryCodes.value = codes
    recoveryCodesAcknowledged.value = false
    statusError.value = ''
  } catch {
    statusError.value = '恢复本地凭据失败，请检查恢复码后重试。'
  } finally {
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
function acknowledgeRecoveryCodes(acknowledged: true) {
  recoveryCodesAcknowledged.value = acknowledged
  if (!recoveryCodesAcknowledged.value || recoveryCodes.value.length === 0) return
  recoveryCodes.value = []
  recoveryCodesAcknowledged.value = false
}
function warnBeforeClosingWithCodes(event: BeforeUnloadEvent) {
  if (recoveryCodes.value.length === 0) return
  event.preventDefault()
  event.returnValue = ''
}
async function openTransfer(mode: 'import' | 'export') { try { exportedJson.value = mode === 'export' ? await store.exportConfig() : ''; importMode.value = mode } catch { statusError.value = '无法读取配置。' } }
async function transfer(json: string, replaceAll: boolean) { try { if (importMode.value === 'export') await navigator.clipboard.writeText(json); else { await store.importConfig(json, replaceAll); selectedSessionId.value = store.sessions[0]?.id ?? null }; importMode.value = null } catch { statusError.value = '配置处理失败，请确认 JSON 内容和字段。' } }
function requestCreateSession() { if (store.groups.length) createSessionOpen.value = true; else void addSession() }
async function addSession(groupId?: string) { const group = store.groups.find((item) => item.id === groupId) ?? store.groups[0] ?? { id: crypto.randomUUID(), name: '默认分组' }; if (!store.groups.length) store.groups.push(group); const id = crypto.randomUUID(); store.sessions.push({ id, groupId: group.id, name: '未命名 SSH 会话', host: 'localhost', port: 22, user: 'root', auth: { kind: 'password', secretId: null } }); selectedSessionId.value = id; createSessionOpen.value = false; await persist() }
async function createGroup(name: string) { const group = { id: crypto.randomUUID(), name }; store.groups.push(group); try { await store.createGroup(group); createGroupOpen.value = false; statusError.value = '' } catch { store.groups.splice(store.groups.findIndex((item) => item.id === group.id), 1); statusError.value = '创建分组失败，请重试。' } }
function requestRemoveGroup(id: string) {
  const sessionIds = store.sessions.filter((session) => session.groupId === id).map((session) => session.id)
  const affectedSessionIds = new Set(sessionIds)
  pendingGroupDeletion.value = {
    id,
    sessionIds,
    ruleCount: store.rules.filter((rule) => affectedSessionIds.has(rule.sessionId)).length,
  }
}
function closeGroupDeletion() { if (!groupDeletionBusy.value) pendingGroupDeletion.value = null }
async function removeGroup() {
  if (groupDeletionBusy.value) return
  const pending = pendingGroupDeletion.value
  if (!pending) return
  groupDeletionBusy.value = true
  const sessionIds = store.sessions.filter((session) => session.groupId === pending.id).map((session) => session.id)
  const affectedSessionIds = new Set(sessionIds)
  try {
    await Promise.all(sessionIds.map((id) => store.disconnectSession(id).catch(() => undefined)))
    await store.deleteGroup(pending.id)
    store.rules.splice(0, store.rules.length, ...store.rules.filter((rule) => !affectedSessionIds.has(rule.sessionId)))
    store.sessions.splice(0, store.sessions.length, ...store.sessions.filter((session) => session.groupId !== pending.id))
    const groupIndex = store.groups.findIndex((group) => group.id === pending.id)
    if (groupIndex >= 0) store.groups.splice(groupIndex, 1)
    selectedSessionId.value = store.sessions[0]?.id ?? null
    pendingGroupDeletion.value = null
    statusError.value = ''
  } catch {
    statusError.value = '删除分组失败，请重试。'
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
    statusError.value = ''
  } catch {
    store.sessions.splice(0, store.sessions.length, ...previousSessions)
    store.rules.splice(0, store.rules.length, ...previousRules)
    selectedSessionId.value = id
    statusError.value = '删除会话失败，请重试。'
  } finally {
    sessionDeletionBusy.value = false
  }
}

watch(selectedSessionId, () => {
  privateKeyPickerGeneration += 1
  clearAuthenticationDrafts()
})
onMounted(async () => {
  window.addEventListener('beforeunload', warnBeforeClosingWithCodes)
  try { await store.initialize(); selectedSessionId.value = store.sessions[0]?.id ?? null } catch {}
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeClosingWithCodes))
</script>

<template>
  <main data-testid="via-app" class="via-app">
    <fieldset data-testid="app-interactions" class="app-interactions" :disabled="authenticationBusy || secretOperationBusy">
    <header class="titlebar">
      <div class="brand"><span class="mark">V</span><span>Via</span><span class="version">V1 MVP</span></div>
      <div v-if="workspaceReady" class="title-actions"><button type="button" @click="openTransfer('import')">⇩ 导入配置</button><button type="button" @click="openTransfer('export')">⇧ 导出配置</button><button type="button" @click="openUnlock">⌁ 解锁凭据</button></div>
    </header>
    <div v-if="workspaceReady" class="workspace">
      <SessionSidebar :groups="groups" :selected-session-id="selectedSessionId ?? ''" @select="selectedSessionId = $event" @create="requestCreateSession" @create-group="createGroupOpen=true" @delete-group="requestRemoveGroup" />
      <section v-if="selectedSession" class="content">
        <header class="session-header">
          <div><p class="section-label">SSH 会话</p><h1>{{ selectedSession.name }}</h1><p class="connection"><span class="live-dot" />{{ selectedSession.user }}@{{ selectedSession.host || '未配置主机' }}:{{ selectedSession.port }}</p></div>
          <div class="header-actions"><button class="success-button" type="button" @click="connect">连接并启动</button><button class="danger-button" type="button" @click="disconnect">断开连接</button><button class="secondary-button" type="button" @click="startAll">↻ 重连隧道</button><button class="danger-button" type="button" @click="requestRemoveSession">删除会话</button></div>
        </header>
        <TunnelGrid :rules="currentRules" @add="addRule" @update="updateRule" @toggle="toggleRule" @remove="requestRemoveRule" @clone="cloneRule" @start-all="startAll" @stop-all="stopAll" />
        <section class="session-editor">
          <div class="editor-title">▤ 当前主机会话配置</div>
          <div class="editor-fields">
            <label>会话名称<input v-model="selectedSession.name" @change="persist" /></label>
            <label>主机地址<input v-model="selectedSession.host" @change="persist" /></label>
            <label>SSH 端口<input v-model.number="selectedSession.port" type="number" @change="persist" /></label>
            <label>登录用户名<input v-model="selectedSession.user" @change="persist" /></label>
            <label>认证方式<select :value="selectedSession.auth.kind" aria-label="认证方式" :disabled="authenticationControlsBusy" @change="changeAuthenticationKind"><option value="password">密码</option><option value="private_key">私钥</option></select></label>
            <template v-if="selectedSession.auth.kind === 'password'">
              <label class="authentication-field">SSH 密码<input v-model="passwordDraft" aria-label="SSH 密码" type="password" autocomplete="new-password" /></label>
            </template>
            <template v-else>
              <label class="authentication-field">私钥文件<input :value="selectedSession.auth.path" aria-label="私钥文件" readonly /></label>
              <button data-testid="choose-private-key" class="secondary-button" type="button" :disabled="authenticationControlsBusy" @click="choosePrivateKey">选择私钥</button>
              <label class="authentication-field">私钥口令（可选）<input v-model="passphraseDraft" aria-label="私钥口令" type="password" autocomplete="new-password" /></label>
            </template>
            <button data-testid="save-authentication" class="primary-button" type="button" :disabled="authenticationControlsBusy" @click="saveAuthentication">保存认证信息</button>
          </div>
        </section>
      </section>
      <EmptyWorkspace v-else @create="requestCreateSession" />
    </div>
    <footer class="statusbar"><span><i class="live-dot" />{{ backendStatus }}</span><span>隧道：{{ activeCount }} 运行中 / {{ errorCount }} 异常</span></footer>
    <ImportDialog :open="importMode!==null" :mode="importMode ?? 'import'" :export-json="exportedJson" @close="importMode=null" @confirm="transfer" />
    <SecretSetupDialog :open="setupOpen" @setup="initializeSecrets" />
    <SecretUnlockDialog :open="unlockOpen" @close="closeUnlock" @unlock="unlock" @recover="recover" @mode-change="changeUnlockMode" />
    <RecoveryCodesDialog :open="recoveryCodes.length > 0" :codes="recoveryCodes" @acknowledge="acknowledgeRecoveryCodes" />
    <HostTrustDialog :open="hostTrust!==null" :host="hostTrust?.host ?? ''" :port="hostTrust?.port ?? 22" :algorithm="hostTrust?.algorithm ?? ''" :fingerprint="hostTrust?.fingerprint ?? ''" @close="hostTrust=null" @approve="approveHostTrust" />
    <ConfirmDialog :open="deleteSessionOpen" :busy="sessionDeletionBusy" title="删除 SSH 会话" message="将删除此会话及其全部 Local 转发规则，此操作不可撤销。" confirm-text="删除会话" @close="closeSessionDeletion" @confirm="removeSession" />
    <ConfirmDialog :open="pendingRuleId!==null" :busy="ruleDeletionBusy" title="删除转发规则" message="将永久删除此转发规则，此操作不可撤销。" confirm-text="删除规则" @close="closeRuleDeletion" @confirm="removeRule" />
    <ConfirmDialog :open="pendingGroupDeletion!==null" :busy="groupDeletionBusy" title="删除分组" :message="deleteGroupMessage" confirm-text="删除分组" @close="closeGroupDeletion" @confirm="removeGroup" />
    <CreateGroupDialog :open="createGroupOpen" @close="createGroupOpen=false" @create="createGroup" />
    <CreateSessionDialog :open="createSessionOpen" :groups="store.groups" @close="createSessionOpen=false" @create="addSession" />
    </fieldset>
  </main>
</template>

<style>
:root { color: #e6edf3; background: #0d1117; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --canvas: #0d1117; --surface: #161b22; --surface-raised: #21262d; --line: #30363d; --text: #e6edf3; --muted: #8b949e; --blue: #388bfd; --green: #3fb950; --red: #f85149; --yellow: #d29922; } * { box-sizing: border-box; } body { margin: 0; min-width: 980px; } button,input,select { font: inherit; } .via-app { display: flex; min-height: 100vh; flex-direction: column; background: var(--canvas); }.app-interactions { display: flex; min-width: 0; min-height: 100vh; flex: 1; flex-direction: column; margin: 0; border: 0; padding: 0; }.titlebar { display: flex; height: 48px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 0 17px; }.brand,.title-actions,.header-actions { display: flex; align-items: center; gap: 10px; }.brand { font-size: 14px; font-weight: 750; }.mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 6px; background: var(--blue); color: white; font-size: 12px; }.version { border: 1px solid rgb(56 139 253 / 35%); border-radius: 4px; background: rgb(56 139 253 / 10%); padding: 2px 5px; color: #79c0ff; font-size: 10px; font-weight: 600; }.title-actions button,.secondary-button,.success-button,.danger-button { border: 1px solid var(--line); border-radius: 6px; background: var(--surface-raised); padding: 7px 10px; color: var(--text); font-size: 12px; cursor: pointer; }.title-actions button:hover,.secondary-button:hover { border-color: var(--muted); }.primary-button { border: 1px solid #4696fa; border-radius: 6px; background: #1f6feb; padding: 7px 10px; color: white; font-size: 12px; font-weight: 650; cursor: pointer; }.primary-button:hover { background: #388bfd; }.success-button { border-color: rgb(63 185 80 / 35%); background: rgb(63 185 80 / 10%); color: #56d364; }.danger-button { border-color: rgb(248 81 73 / 35%); background: rgb(248 81 73 / 8%); color: #ff7b72; }.workspace { display: flex; min-height: 0; flex: 1; }.content { display: flex; min-width: 0; flex: 1; flex-direction: column; }.session-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 17px 20px; }.section-label { margin: 0 0 4px; color: var(--blue); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }.session-header h1 { margin: 0; font-size: 16px; }.connection { display: flex; align-items: center; gap: 6px; margin: 5px 0 0; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }.live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 7px var(--green); }.connected { color: #56d364; font-size: 12px; }.session-editor { border-top: 1px solid var(--line); background: var(--surface); padding: 14px 20px 17px; }.editor-title { margin-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 700; }.editor-fields { display: grid; grid-template-columns: 1fr 1.3fr 90px 1fr 1.5fr; gap: 12px; }.editor-fields label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }.editor-fields input,.editor-fields select { min-width: 0; border: 1px solid var(--line); border-radius: 5px; outline: 0; background: var(--canvas); padding: 7px 8px; color: var(--text); font-size: 12px; }.editor-fields input:focus,.editor-fields select:focus { border-color: var(--blue); }.editor-fields > button { align-self: end; }.statusbar { display: flex; height: 26px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 0 17px; color: var(--muted); font-size: 11px; }.statusbar span { display: flex; align-items: center; gap: 6px; } @media (max-width: 1100px) { .editor-fields { grid-template-columns: repeat(2, 1fr); }.key-path { grid-column: span 2; } }
</style>
