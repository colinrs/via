<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { injectI18n } from '../i18n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  unlock: [password: string]
  recover: [code: string, password: string]
  'mode-change': [mode: 'unlock' | 'recovery']
}>()
const mode = ref<'unlock' | 'recovery'>('unlock')
const password = ref('')
const recoveryCode = ref('')
const newPassword = ref('')
const confirmation = ref('')
const { t } = injectI18n()
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
  emit('mode-change', nextMode)
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
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="mode === 'unlock' ? t('dialog.unlock.title') : t('dialog.recover.title')">
    <section class="dialog">
      <template v-if="mode === 'unlock'">
        <h2>{{ t('dialog.unlock.title') }}</h2>
        <p>{{ t('dialog.unlock.description') }}</p>
        <label>
          {{ t('field.appMasterPassword') }}
          <input v-model="password" type="password" autocomplete="current-password" :aria-label="t('field.appMasterPassword')" autofocus @keyup.enter="submitUnlock">
        </label>
        <button data-testid="show-recovery" class="link" type="button" @click="selectMode('recovery')">{{ t('action.useRecoveryCode') }}</button>
        <footer>
          <button data-testid="close-secret-unlock" type="button" @click="close">{{ t('common.cancel') }}</button>
          <button data-testid="unlock-secrets-action" class="primary" type="button" :disabled="!canUnlock" @click="submitUnlock">{{ t('action.unlock') }}</button>
        </footer>
      </template>
      <template v-else>
        <h2>{{ t('dialog.recover.title') }}</h2>
        <p>{{ t('dialog.recover.description') }}</p>
        <label>
          {{ t('field.recoveryCode') }}
          <input v-model="recoveryCode" autocomplete="one-time-code" :aria-label="t('field.recoveryCode')" autofocus>
        </label>
        <label>
          {{ t('field.newMasterPassword') }}
          <input v-model="newPassword" type="password" autocomplete="new-password" :aria-label="t('field.newMasterPassword')">
        </label>
        <label>
          {{ t('field.confirmNewMasterPassword') }}
          <input v-model="confirmation" type="password" autocomplete="new-password" :aria-label="t('field.confirmNewMasterPassword')" @keyup.enter="submitRecovery">
        </label>
        <button data-testid="show-unlock" class="link" type="button" @click="selectMode('unlock')">{{ t('action.backToUnlock') }}</button>
        <footer>
          <button data-testid="close-secret-unlock" type="button" @click="close">{{ t('common.cancel') }}</button>
          <button data-testid="recover-secrets-action" class="primary" type="button" :disabled="!canRecover" @click="submitRecovery">{{ t('action.recoverAndReset') }}</button>
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(420px,calc(100vw - 32px));border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}.dialog label{display:grid;gap:6px;margin-top:12px;color:var(--muted);font-size:12px}.dialog input{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}.link{border:0;background:transparent;margin-top:12px;padding-inline:0;color:#58a6ff}
</style>
