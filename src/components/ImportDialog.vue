<script setup lang="ts">
import { ref, watch } from 'vue'
import { injectI18n } from '../i18n'
const props = defineProps<{
  open: boolean
  mode: 'import' | 'export'
  exportJson?: string
}>()
const emit = defineEmits<{
  close: []
  confirm: [json: string, replaceAll: boolean]
}>()
const json = ref('')
const { t } = injectI18n()
const DEMO_JSON = `{
  "schemaVersion": 1,
  "groups": [
    { "id": "00000000-0000-4000-8000-000000000001", "name": "Demo group" }
  ],
  "sessions": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "groupId": "00000000-0000-4000-8000-000000000001",
      "name": "Demo SSH session",
      "host": "ssh.example.com",
      "port": 22,
      "user": "root",
      "auth": { "kind": "password" }
    }
  ],
  "rules": [
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "sessionId": "00000000-0000-4000-8000-000000000002",
      "enabled": true,
      "localPort": 5432,
      "targetHost": "localhost",
      "targetPort": 5432,
      "note": "Demo rule"
    }
  ]
}`
function fillExample() {
  json.value = DEMO_JSON
}
watch(
  () => props.exportJson,
  (value) => {
    json.value = value ?? ''
  },
  { immediate: true }
)
</script>
<template>
  <div
    v-if="open"
    class="backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="
      mode === 'import' ? t('dialog.import.title') : t('dialog.export.title')
    "
  >
    <section class="dialog">
      <h2>
        {{
          mode === 'import'
            ? t('dialog.import.title')
            : t('dialog.export.title')
        }}
      </h2>
      <p v-if="mode === 'export'">{{ t('dialog.export.description') }}</p>
      <p v-else>{{ t('dialog.import.description') }}</p>
      <textarea
        v-model="json"
        :readonly="mode === 'export'"
        :placeholder="mode === 'import' ? t('placeholder.pasteJson') : ''"
        :aria-label="t('field.configJson')"
      />
      <footer>
        <button
          v-if="mode === 'import'"
          class="fill-example"
          @click="fillExample"
        >
          {{ t('action.fillExample') }}</button
        ><button @click="emit('close')">{{ t('common.cancel') }}</button
        ><button
          v-if="mode === 'import'"
          :disabled="!json.trim()"
          @click="emit('confirm', json, false)"
        >
          {{ t('action.mergeImport') }}</button
        ><button
          v-if="mode === 'import'"
          class="danger"
          :disabled="!json.trim()"
          @click="emit('confirm', json, true)"
        >
          {{ t('action.replaceAll') }}</button
        ><button v-else class="primary" @click="emit('confirm', json, false)">
          {{ t('action.copyJson') }}
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
.dialog textarea {
  width: 100%;
  min-height: 160px;
  border: 1px solid var(--line);
  background: var(--content);
  padding: 8px;
  color: var(--text);
  font: 12px var(--font-mono);
  resize: vertical;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset);
}
.dialog footer {
  margin-top: 12px;
}
.dialog .fill-example {
  margin-right: auto;
}
.dialog .primary {
  border-width: 2px;
  font-weight: 700;
}
.dialog .danger {
  border: 2px solid var(--line);
  color: var(--text);
}
</style>
