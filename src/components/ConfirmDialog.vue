<script setup lang="ts">
import { onMounted } from 'vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; message: string; confirmText: string; busy?: boolean; generation?: number }>(), {
  busy: false,
  generation: 0,
})
const emit = defineEmits<{ close: []; confirm: []; ready: [generation: number] }>()

onMounted(() => emit('ready', props.generation))

function close() { if (!props.busy) emit('close') }
function confirm() { if (!props.busy) emit('confirm') }
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="title" :aria-busy="busy">
    <section class="dialog">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <footer>
        <button type="button" :disabled="busy" @click="close">取消</button>
        <button data-testid="confirm-dialog-action" class="danger" type="button" :disabled="busy" @click="confirm">{{ busy ? `${confirmText}中…` : confirmText }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(410px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{margin:12px 0 18px;color:var(--muted);font-size:13px;line-height:1.6}footer{display:flex;justify-content:flex-end;gap:8px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}button:disabled{cursor:wait;opacity:.65}.danger{border-color:#f8514970;background:#f8514914;color:#ff7b72}
</style>
