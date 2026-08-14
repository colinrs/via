<script setup lang="ts">
import { injectI18n } from '../i18n'

defineProps<{ open: boolean; host: string; port: number; algorithm: string; fingerprint: string }>()
const emit = defineEmits<{ close: []; approve: [] }>()
const { t } = injectI18n()
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="t('dialog.hostTrust.title')">
    <section class="dialog">
      <h2>{{ t('dialog.hostTrust.title') }}</h2>
      <p>{{ t('dialog.hostTrust.description') }}</p>
      <dl><dt>{{ t('dialog.hostTrust.host') }}</dt><dd>{{ host }}:{{ port }}</dd><dt>{{ t('dialog.hostTrust.algorithm') }}</dt><dd>{{ algorithm }}</dd><dt>{{ t('dialog.hostTrust.fingerprint') }}</dt><dd class="fingerprint">{{ fingerprint }}</dd></dl>
      <footer><button type="button" @click="emit('close')">{{ t('common.cancel') }}</button><button class="primary" type="button" @click="emit('approve')">{{ t('action.trustAndConnect') }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:10}.dialog{width:min(480px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}dl{display:grid;grid-template-columns:112px 1fr;gap:8px;margin:16px 0}dt{color:var(--muted);font-size:12px}dd{margin:0;font:12px ui-monospace,monospace;word-break:break-all}.fingerprint{border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px}footer{display:flex;justify-content:flex-end;gap:8px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}
</style>
