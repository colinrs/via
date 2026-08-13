<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import EmptyWorkspace from './components/EmptyWorkspace.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import CreateGroupDialog from './components/CreateGroupDialog.vue'
import CreateSessionDialog from './components/CreateSessionDialog.vue'
import HostTrustDialog from './components/HostTrustDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import SecretUnlockDialog from './components/SecretUnlockDialog.vue'
import SessionSidebar, { type SessionGroup } from './components/SessionSidebar.vue'
import TunnelGrid from './components/TunnelGrid.vue'
import { createViaStore } from './stores/via'
import type { LocalForwardRule } from './types/via'

const store = createViaStore()
const selectedSessionId = ref<string | null>(null)
const importMode = ref<'import' | 'export' | null>(null)
const unlockOpen = ref(false)
const statusError = ref('')
const exportedJson = ref('')
const hostTrust = ref<{ host: string; port: number; algorithm: string; fingerprint: string } | null>(null)
const deleteSessionOpen = ref(false)
const pendingRuleId = ref<string | null>(null)
const pendingGroupDeletion = ref<{ id: string; sessionIds: string[]; ruleCount: number } | null>(null)
const createGroupOpen = ref(false)
const createSessionOpen = ref(false)

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

async function persist() { try { await store.save(); statusError.value = ''; return true } catch { statusError.value = '保存失败，请检查会话和规则填写是否完整。'; return false } }
async function updateRule(nextRule: LocalForwardRule) { const index = store.rules.findIndex((rule) => rule.id === nextRule.id); if (index >= 0) store.rules.splice(index, 1, nextRule); await persist() }
async function toggleRule(nextRule: LocalForwardRule) { await updateRule(nextRule); try { if (nextRule.enabled) await store.startRule(nextRule.id); else await store.stopRule(nextRule.id) } catch { statusError.value = '规则操作失败：请先连接 SSH 会话并检查端口。' } }
async function addRule() { if (!selectedSessionId.value) return; store.rules.push({ id: crypto.randomUUID(), sessionId: selectedSessionId.value, enabled: false, localPort: 1, targetHost: 'localhost', targetPort: 1, note: '', runtimeState: 'stopped' }); await persist() }
async function cloneRule(id: string) { const source = store.rules.find((rule) => rule.id === id); if (source) { store.rules.push({ ...source, id: crypto.randomUUID(), localPort: 1, runtimeState: 'stopped', enabled: false }); await persist() } }
function requestRemoveRule(id: string) { pendingRuleId.value = id }
async function removeRule() {
  const id = pendingRuleId.value
  if (!id) return
  const rule = store.rules.find((item) => item.id === id)
  if (!rule) { pendingRuleId.value = null; return }
  if (rule.runtimeState !== 'stopped') await store.stopRule(id).catch(() => undefined)
  try {
    await store.deleteRule(id)
    const index = store.rules.findIndex((item) => item.id === id)
    if (index >= 0) store.rules.splice(index, 1)
    pendingRuleId.value = null
    statusError.value = ''
  } catch {
    statusError.value = '删除规则失败，请重试。'
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
async function unlock(password: string) { try { await store.unlockSecrets(password); unlockOpen.value = false; statusError.value = '' } catch { statusError.value = '主密码不正确，无法解锁本地凭据。' } }
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
async function removeGroup() {
  const pending = pendingGroupDeletion.value
  if (!pending) return
  await Promise.all(pending.sessionIds.map((id) => store.disconnectSession(id).catch(() => undefined)))
  try {
    await store.deleteGroup(pending.id)
    const affectedSessionIds = new Set(pending.sessionIds)
    store.rules.splice(0, store.rules.length, ...store.rules.filter((rule) => !affectedSessionIds.has(rule.sessionId)))
    store.sessions.splice(0, store.sessions.length, ...store.sessions.filter((session) => session.groupId !== pending.id))
    const groupIndex = store.groups.findIndex((group) => group.id === pending.id)
    if (groupIndex >= 0) store.groups.splice(groupIndex, 1)
    selectedSessionId.value = store.sessions[0]?.id ?? null
    pendingGroupDeletion.value = null
    statusError.value = ''
  } catch {
    statusError.value = '删除分组失败，请重试。'
  }
}
function requestRemoveSession() { if (selectedSessionId.value) deleteSessionOpen.value = true }
async function removeSession() {
  if (!selectedSessionId.value) return
  const id = selectedSessionId.value
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
  }
}

onMounted(async () => { try { await store.initialize(); selectedSessionId.value = store.sessions[0]?.id ?? null } catch {} })
</script>

<template>
  <main data-testid="via-app" class="via-app">
    <header class="titlebar">
      <div class="brand"><span class="mark">V</span><span>Via</span><span class="version">V1 MVP</span></div>
      <div class="title-actions"><button type="button" @click="openTransfer('import')">⇩ 导入配置</button><button type="button" @click="openTransfer('export')">⇧ 导出配置</button><button type="button" @click="unlockOpen=true">⌁ 解锁凭据</button></div>
    </header>
    <div class="workspace">
      <SessionSidebar :groups="groups" :selected-session-id="selectedSessionId ?? ''" @select="selectedSessionId = $event" @create="requestCreateSession" @create-group="createGroupOpen=true" @delete-group="requestRemoveGroup" />
      <section v-if="selectedSession" class="content">
        <header class="session-header">
          <div><p class="section-label">SSH 会话</p><h1>{{ selectedSession.name }}</h1><p class="connection"><span class="live-dot" />{{ selectedSession.user }}@{{ selectedSession.host || '未配置主机' }}:{{ selectedSession.port }}</p></div>
          <div class="header-actions"><button class="success-button" type="button" @click="connect">连接并启动</button><button class="danger-button" type="button" @click="disconnect">断开连接</button><button class="secondary-button" type="button" @click="startAll">↻ 重连隧道</button><button class="danger-button" type="button" @click="requestRemoveSession">删除会话</button></div>
        </header>
        <TunnelGrid :rules="currentRules" @add="addRule" @update="updateRule" @toggle="toggleRule" @remove="requestRemoveRule" @clone="cloneRule" @start-all="startAll" @stop-all="stopAll" />
        <section class="session-editor"><div class="editor-title">▤ 当前主机会话配置</div><div class="editor-fields"><label>会话名称<input v-model="selectedSession.name" @change="persist" /></label><label>主机地址<input v-model="selectedSession.host" @change="persist" /></label><label>SSH 端口<input v-model.number="selectedSession.port" type="number" @change="persist" /></label><label>登录用户名<input v-model="selectedSession.user" @change="persist" /></label><label class="key-path">认证方式<input :value="selectedSession.auth.kind === 'private_key' ? '私钥文件（路径仅本地保存）' : '密码认证（凭据不会导出）'" readonly /></label></div></section>
      </section>
      <EmptyWorkspace v-else @create="requestCreateSession" />
    </div>
    <footer class="statusbar"><span><i class="live-dot" />{{ backendStatus }}</span><span>隧道：{{ activeCount }} 运行中 / {{ errorCount }} 异常</span></footer>
    <ImportDialog :open="importMode!==null" :mode="importMode ?? 'import'" :export-json="exportedJson" @close="importMode=null" @confirm="transfer" />
    <SecretUnlockDialog :open="unlockOpen" @close="unlockOpen=false" @unlock="unlock" />
    <HostTrustDialog :open="hostTrust!==null" :host="hostTrust?.host ?? ''" :port="hostTrust?.port ?? 22" :algorithm="hostTrust?.algorithm ?? ''" :fingerprint="hostTrust?.fingerprint ?? ''" @close="hostTrust=null" @approve="approveHostTrust" />
    <ConfirmDialog :open="deleteSessionOpen" title="删除 SSH 会话" message="将删除此会话及其全部 Local 转发规则，此操作不可撤销。" confirm-text="删除会话" @close="deleteSessionOpen=false" @confirm="removeSession" />
    <ConfirmDialog :open="pendingRuleId!==null" title="删除转发规则" message="将永久删除此转发规则，此操作不可撤销。" confirm-text="删除规则" @close="pendingRuleId=null" @confirm="removeRule" />
    <ConfirmDialog :open="pendingGroupDeletion!==null" title="删除分组" :message="deleteGroupMessage" confirm-text="删除分组" @close="pendingGroupDeletion=null" @confirm="removeGroup" />
    <CreateGroupDialog :open="createGroupOpen" @close="createGroupOpen=false" @create="createGroup" />
    <CreateSessionDialog :open="createSessionOpen" :groups="store.groups" @close="createSessionOpen=false" @create="addSession" />
  </main>
</template>

<style>
:root { color: #e6edf3; background: #0d1117; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --canvas: #0d1117; --surface: #161b22; --surface-raised: #21262d; --line: #30363d; --text: #e6edf3; --muted: #8b949e; --blue: #388bfd; --green: #3fb950; --red: #f85149; --yellow: #d29922; } * { box-sizing: border-box; } body { margin: 0; min-width: 980px; } button,input { font: inherit; } .via-app { display: flex; min-height: 100vh; flex-direction: column; background: var(--canvas); }.titlebar { display: flex; height: 48px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 0 17px; }.brand,.title-actions,.header-actions { display: flex; align-items: center; gap: 10px; }.brand { font-size: 14px; font-weight: 750; }.mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 6px; background: var(--blue); color: white; font-size: 12px; }.version { border: 1px solid rgb(56 139 253 / 35%); border-radius: 4px; background: rgb(56 139 253 / 10%); padding: 2px 5px; color: #79c0ff; font-size: 10px; font-weight: 600; }.title-actions button,.secondary-button,.success-button,.danger-button { border: 1px solid var(--line); border-radius: 6px; background: var(--surface-raised); padding: 7px 10px; color: var(--text); font-size: 12px; cursor: pointer; }.title-actions button:hover,.secondary-button:hover { border-color: var(--muted); }.primary-button { border: 1px solid #4696fa; border-radius: 6px; background: #1f6feb; padding: 7px 10px; color: white; font-size: 12px; font-weight: 650; cursor: pointer; }.primary-button:hover { background: #388bfd; }.success-button { border-color: rgb(63 185 80 / 35%); background: rgb(63 185 80 / 10%); color: #56d364; }.danger-button { border-color: rgb(248 81 73 / 35%); background: rgb(248 81 73 / 8%); color: #ff7b72; }.workspace { display: flex; min-height: 0; flex: 1; }.content { display: flex; min-width: 0; flex: 1; flex-direction: column; }.session-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface); padding: 17px 20px; }.section-label { margin: 0 0 4px; color: var(--blue); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }.session-header h1 { margin: 0; font-size: 16px; }.connection { display: flex; align-items: center; gap: 6px; margin: 5px 0 0; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }.live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 7px var(--green); }.connected { color: #56d364; font-size: 12px; }.session-editor { border-top: 1px solid var(--line); background: var(--surface); padding: 14px 20px 17px; }.editor-title { margin-bottom: 11px; color: var(--muted); font-size: 12px; font-weight: 700; }.editor-fields { display: grid; grid-template-columns: 1fr 1.3fr 90px 1fr 1.5fr; gap: 12px; }.editor-fields label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }.editor-fields input { min-width: 0; border: 1px solid var(--line); border-radius: 5px; outline: 0; background: var(--canvas); padding: 7px 8px; color: var(--text); font-size: 12px; }.editor-fields input:focus { border-color: var(--blue); }.statusbar { display: flex; height: 26px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); padding: 0 17px; color: var(--muted); font-size: 11px; }.statusbar span { display: flex; align-items: center; gap: 6px; } @media (max-width: 1100px) { .editor-fields { grid-template-columns: repeat(2, 1fr); }.key-path { grid-column: span 2; } }
</style>
