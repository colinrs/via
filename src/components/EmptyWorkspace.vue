<script setup lang="ts">
import { injectI18n } from '../i18n'

const emit = defineEmits<{ create: [] }>()
const { t } = injectI18n()
</script>

<template>
  <section class="empty-workspace" data-testid="empty-workspace">
    <div class="empty-icon" aria-hidden="true">⇄</div>
    <h1>{{ t('empty.title') }}</h1>
    <p>{{ t('empty.description') }}</p>
    <button class="primary-button" type="button" @click="emit('create')"><span aria-hidden="true">＋</span> {{ t('action.newSshSession') }}</button>
  </section>
</template>

<style scoped>
.empty-workspace { display: grid; flex: 1; place-content: center; justify-items: center; gap: 10px; padding: 48px; text-align: center; }
.empty-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--blue); font-size: 25px; }
h1 { margin: 6px 0 0; font-size: 18px; } p { max-width: 390px; margin: 0 0 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
</style>
