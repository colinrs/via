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
.toast { max-width: 520px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-raised); padding: 9px 14px; color: var(--text); font-size: 12px; box-shadow: var(--shadow-soft); }
.toast-error { border-color: rgb(248 81 73 / 45%); background: rgb(248 81 73 / 14%); color: #ffb3ac; }
.toast-success { border-color: rgb(63 185 80 / 45%); background: rgb(63 185 80 / 14%); color: #7ee787; }
.toast-info { border-color: rgb(56 139 253 / 45%); background: rgb(56 139 253 / 14%); color: #a5c8ff; }
</style>
