<script setup lang="ts">
import { ref, watch } from 'vue'

import { injectI18n } from '../i18n'

const props = defineProps<{ open: boolean; codes: string[] }>()
const emit = defineEmits<{
  acknowledge: [acknowledged: true]
  download: []
  close: []
}>()
const acknowledged = ref(false)
const { t } = injectI18n()

function acknowledge() {
  if (!acknowledged.value) return
  emit('acknowledge', true)
  acknowledged.value = false
}

watch(
  () => props.open,
  () => {
    acknowledged.value = false
  }
)
</script>

<template>
  <div
    v-if="open"
    class="backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="t('dialog.recoveryCodes.title')"
  >
    <section class="dialog">
      <h2>{{ t('dialog.recoveryCodes.title') }}</h2>
      <p class="warning">{{ t('dialog.recoveryCodes.warning') }}</p>
      <ol data-testid="recovery-codes-list" class="codes selectable">
        <li v-for="(code, index) in codes" :key="index">
          <code data-testid="recovery-code">{{ code }}</code>
        </li>
      </ol>
      <label class="acknowledgement">
        <input
          v-model="acknowledged"
          type="checkbox"
          :aria-label="t('aria.recoveryCodesAcknowledged')"
        />
        {{ t('dialog.recoveryCodes.acknowledge') }}
      </label>
      <footer>
        <button
          data-testid="download-recovery-codes"
          type="button"
          @click="emit('download')"
        >
          {{ t('action.downloadRecoveryCodes') }}
        </button>
        <button
          data-testid="close-recovery-codes"
          class="primary"
          type="button"
          :disabled="!acknowledged"
          @click="acknowledge"
        >
          {{ t('action.iSaved') }}
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
.warning {
  color: var(--yellow);
  font-size: 13px;
  line-height: 1.6;
}
.codes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0;
  padding: 0;
  list-style: none;
}
.codes li {
  border: 1px solid var(--line);
  background: var(--content);
  padding: 8px;
  text-align: center;
}
.codes code {
  user-select: all;
  color: var(--text);
  font-family: var(--font-mono);
}
.acknowledgement {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
footer {
  margin-top: 16px;
}
.primary {
  border-width: 2px;
  font-weight: 700;
}
</style>
