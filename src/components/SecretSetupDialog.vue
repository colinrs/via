<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { injectI18n } from '../i18n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; setup: [password: string] }>()
const password = ref('')
const confirmation = ref('')
const { t } = injectI18n()
const canSetup = computed(
  () =>
    password.value.trim().length > 0 && password.value === confirmation.value
)

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
  <div
    v-if="open"
    class="backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="t('dialog.secretSetup.title')"
  >
    <section class="dialog">
      <h2>{{ t('dialog.secretSetup.title') }}</h2>
      <p>{{ t('dialog.secretSetup.description') }}</p>
      <label>
        {{ t('field.masterPassword') }}
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          :aria-label="t('field.masterPassword')"
          autofocus
        />
      </label>
      <label>
        {{ t('field.confirmMasterPassword') }}
        <input
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          :aria-label="t('field.confirmMasterPassword')"
          @keyup.enter="submit"
        />
      </label>
      <footer>
        <button data-testid="close-secret-setup" type="button" @click="close">
          {{ t('common.cancel') }}
        </button>
        <button
          data-testid="setup-secrets-action"
          class="primary"
          type="button"
          :disabled="!canSetup"
          @click="submit"
        >
          {{ t('action.createCredentialStore') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0008;
  z-index: 20;
}
.dialog {
  width: min(410px, calc(100vw - 32px));
  border: 1px solid var(--line);
  background: var(--content);
  padding: 20px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-drop);
}
.dialog h2 {
  margin: 0;
  font-size: 16px;
  font-family: var(--font-ui);
}
.dialog p {
  margin: 12px 0 18px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
button {
  border: 1px solid var(--line);
  background: var(--surface-raised);
  padding: 7px 10px;
  color: var(--text);
  cursor: pointer;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-raised);
}
button:active {
  box-shadow: var(--shadow-raised-active);
}
button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.danger {
  border: 2px solid var(--line);
}
.dialog label {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 12px;
}
.dialog input {
  border: 1px solid var(--line);
  background: var(--content);
  padding: 8px;
  color: var(--text);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset);
}
footer {
  margin-top: 16px;
}
.primary {
  border-width: 2px;
  font-weight: 700;
}
</style>
