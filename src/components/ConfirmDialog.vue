<script setup lang="ts">
import { onMounted } from 'vue'

import { injectI18n } from '../i18n'

const props = withDefaults(defineProps<{ open: boolean; title: string; message: string; confirmText: string; busy?: boolean; generation?: number }>(), {
  busy: false,
  generation: 0,
})
const emit = defineEmits<{ close: []; confirm: [generation: number]; ready: [generation: number] }>()
const { t } = injectI18n()

onMounted(() => emit('ready', props.generation))

function close() { if (!props.busy) emit('close') }
function confirm() { if (!props.busy) emit('confirm', props.generation) }
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="title" :aria-busy="busy">
    <section class="dialog">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <footer>
        <button type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button data-testid="confirm-dialog-action" class="danger" type="button" :disabled="busy" @click="confirm">{{ busy ? t('common.inProgress', { action: confirmText }) : confirmText }}</button>
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
</style>
