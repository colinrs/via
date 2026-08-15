<script setup lang="ts">
import { ref, watch } from 'vue'

import { injectI18n } from '../i18n'
import type { Group } from '../types/via'

const props = defineProps<{ open: boolean; groups: Group[] }>()
const emit = defineEmits<{ close: []; create: [groupId: string] }>()
const selectedGroupId = ref('')
const { t } = injectI18n()

watch(
  () => props.open,
  (open) => {
    if (open) selectedGroupId.value = props.groups[0]?.id ?? ''
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="t('dialog.newSession.title')">
    <section class="dialog">
      <h2>{{ t('dialog.newSession.title') }}</h2>
      <label>
        {{ t('field.group') }}
        <select v-model="selectedGroupId" :aria-label="t('field.group')">
          <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
      <footer>
        <button type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button data-testid="create-session-action" class="primary" type="button" @click="emit('create', selectedGroupId)">{{ t('action.createSession') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: #0008; z-index: 20; }
.dialog { width: min(410px, calc(100vw - 32px)); border: 1px solid var(--line); background: var(--content); padding: 20px; border-radius: var(--radius-lg); box-shadow: var(--shadow-drop); }
.dialog h2 { margin: 0; font-size: 16px; font-family: var(--font-ui); }
.dialog p { margin: 12px 0 18px; color: var(--muted); font-size: 13px; line-height: 1.6; }
footer { display: flex; justify-content: flex-end; gap: 8px; }
button { border: 1px solid var(--line); background: var(--surface-raised); padding: 7px 10px; color: var(--text); cursor: pointer; border-radius: var(--radius-sm); box-shadow: var(--shadow-raised); }
button:active { box-shadow: var(--shadow-raised-active); }
button:disabled { cursor: wait; opacity: .6; }
.danger { border: 2px solid var(--line); }
.dialog label { display: grid; gap: 6px; margin-top: 16px; color: var(--muted); font-size: 12px; }
.dialog input, .dialog select { border: 1px solid var(--line); background: var(--content); padding: 8px; color: var(--text); border-radius: var(--radius-sm); box-shadow: var(--shadow-inset); }
.primary { border-width: 2px; font-weight: 700; }
footer { margin-top: 16px; }
</style>
