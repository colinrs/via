<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; setup: [password: string] }>()
const password = ref('')
const confirmation = ref('')
const canSetup = computed(() => password.value.trim().length > 0 && password.value === confirmation.value)

function clearSecrets() {
  password.value = ''
  confirmation.value = ''
}

function submit() {
  if (!canSetup.value) return
  emit('setup', password.value)
  clearSecrets()
}

function close() {
  emit('close')
  clearSecrets()
}

watch(() => props.open, clearSecrets)
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" aria-label="初始化本地凭据">
    <section class="dialog">
      <h2>初始化本地凭据</h2>
      <p>设置应用主密码，用于加密保存在这台设备上的 SSH 密码和私钥口令。</p>
      <label>
        主密码
        <input v-model="password" type="password" autocomplete="new-password" aria-label="主密码" autofocus>
      </label>
      <label>
        确认主密码
        <input v-model="confirmation" type="password" autocomplete="new-password" aria-label="确认主密码" @keyup.enter="submit">
      </label>
      <footer>
        <button data-testid="close-secret-setup" type="button" @click="close">取消</button>
        <button data-testid="setup-secrets-action" class="primary" type="button" :disabled="!canSetup" @click="submit">创建凭据库</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(420px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}.dialog label{display:grid;gap:6px;margin-top:12px;color:var(--muted);font-size:12px}.dialog input{border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}
</style>
