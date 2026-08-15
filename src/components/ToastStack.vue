<script setup lang="ts">
import type { Toast } from '../stores/toast'

import { injectI18n } from '../i18n'

defineProps<{ toasts: Toast[] }>()

const { t } = injectI18n()
</script>

<template>
  <div v-if="toasts.length" data-testid="toast-stack" class="toast-stack" role="region" :aria-label="t('aria.notifications')">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast-${toast.tone}`" role="status">{{ toast.message }}</div>
  </div>
</template>

<style scoped>
.toast-stack { position: fixed; top: 14px; left: 50%; z-index: 100; display: flex; flex-direction: column; align-items: center; gap: 8px; transform: translateX(-50%); pointer-events: none; }
.toast { display: flex; align-items: center; gap: 8px; max-width: 520px; border: 1px solid var(--line); background: var(--content); padding: 9px 14px; color: var(--text); font-size: 12px; box-shadow: 3px 3px 0 rgb(0 0 0 / 25%); }
.toast::before { content: ''; width: 8px; height: 8px; background: var(--muted); }
.toast-error { color: var(--text); }
.toast-error::before { background: var(--red); }
.toast-success::before { background: var(--green); }
.toast-info::before { background: var(--muted); }
</style>
