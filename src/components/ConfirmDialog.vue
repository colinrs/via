<script setup lang="ts">
defineProps<{ open: boolean; title: string; message: string; confirmText: string }>()
const emit = defineEmits<{ close: []; confirm: [] }>()
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="title">
    <section class="dialog">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <footer>
        <button type="button" @click="emit('close')">取消</button>
        <button data-testid="confirm-dialog-action" class="danger" type="button" @click="emit('confirm')">{{ confirmText }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(410px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{margin:12px 0 18px;color:var(--muted);font-size:13px;line-height:1.6}footer{display:flex;justify-content:flex-end;gap:8px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.danger{border-color:#f8514970;background:#f8514914;color:#ff7b72}
</style>
