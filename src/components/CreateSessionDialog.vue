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
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(400px,calc(100vw - 32px));border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog label{display:grid;gap:6px;margin-top:16px;color:var(--muted);font-size:12px}.dialog select{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}
</style>
