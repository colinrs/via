<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  unlock: [password: string]
  recover: [code: string, password: string]
}>()
const mode = ref<'unlock' | 'recovery'>('unlock')
const password = ref('')
const recoveryCode = ref('')
const newPassword = ref('')
const confirmation = ref('')
const canUnlock = computed(() => password.value.trim().length > 0)
const canRecover = computed(() => recoveryCode.value.trim().length > 0
  && newPassword.value.trim().length > 0
  && newPassword.value === confirmation.value)

function clearSecrets() {
  password.value = ''
  recoveryCode.value = ''
  newPassword.value = ''
  confirmation.value = ''
}

function selectMode(nextMode: 'unlock' | 'recovery') {
  clearSecrets()
  mode.value = nextMode
}

function submitUnlock() {
  if (!canUnlock.value) return
  emit('unlock', password.value)
  clearSecrets()
}

function submitRecovery() {
  if (!canRecover.value) return
  emit('recover', recoveryCode.value, newPassword.value)
  clearSecrets()
}

function close() {
  emit('close')
  clearSecrets()
  mode.value = 'unlock'
}

watch(() => props.open, () => {
  clearSecrets()
  mode.value = 'unlock'
})
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" aria-label="解锁本地凭据">
    <section class="dialog">
      <template v-if="mode === 'unlock'">
        <h2>解锁本地凭据</h2>
        <p>输入应用主密码以使用已保存的 SSH 密码和私钥口令。</p>
        <label>
          应用主密码
          <input v-model="password" type="password" autocomplete="current-password" aria-label="应用主密码" autofocus @keyup.enter="submitUnlock">
        </label>
        <button data-testid="show-recovery" class="link" type="button" @click="selectMode('recovery')">使用恢复码</button>
        <footer>
          <button data-testid="close-secret-unlock" type="button" @click="close">取消</button>
          <button data-testid="unlock-secrets-action" class="primary" type="button" :disabled="!canUnlock" @click="submitUnlock">解锁</button>
        </footer>
      </template>
      <template v-else>
        <h2>恢复本地凭据</h2>
        <p>输入一枚未使用的恢复码，并为凭据库设置新的主密码。</p>
        <label>
          恢复码
          <input v-model="recoveryCode" autocomplete="one-time-code" aria-label="恢复码" autofocus>
        </label>
        <label>
          新主密码
          <input v-model="newPassword" type="password" autocomplete="new-password" aria-label="新主密码">
        </label>
        <label>
          确认新主密码
          <input v-model="confirmation" type="password" autocomplete="new-password" aria-label="确认新主密码" @keyup.enter="submitRecovery">
        </label>
        <button data-testid="show-unlock" class="link" type="button" @click="selectMode('unlock')">返回主密码解锁</button>
        <footer>
          <button data-testid="close-secret-unlock" type="button" @click="close">取消</button>
          <button data-testid="recover-secrets-action" class="primary" type="button" :disabled="!canRecover" @click="submitRecovery">恢复并重设密码</button>
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(420px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}.dialog label{display:grid;gap:6px;margin-top:12px;color:var(--muted);font-size:12px}.dialog input{border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}.link{border:0;background:transparent;margin-top:12px;padding-inline:0;color:#58a6ff}
</style>
