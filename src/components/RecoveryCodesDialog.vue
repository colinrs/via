<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean; codes: string[] }>()
const emit = defineEmits<{ close: [] }>()
const acknowledged = ref(false)

function close() {
  if (!acknowledged.value) return
  emit('close')
  acknowledged.value = false
}

watch(() => props.open, () => { acknowledged.value = false })
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" aria-label="保存恢复码">
    <section class="dialog">
      <h2>保存恢复码</h2>
      <p class="warning">这些恢复码仅显示一次。请立即复制并保存在安全的位置。</p>
      <ol data-testid="recovery-codes-list" class="codes selectable">
        <li v-for="(code, index) in codes" :key="index"><code data-testid="recovery-code">{{ code }}</code></li>
      </ol>
      <label class="acknowledgement">
        <input v-model="acknowledged" type="checkbox" aria-label="我已保存恢复码">
        我已将恢复码保存在安全的位置
      </label>
      <footer>
        <button data-testid="close-recovery-codes" class="primary" type="button" :disabled="!acknowledged" @click="close">我已保存</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:30}.dialog{width:min(460px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.warning{color:#d29922;font-size:13px;line-height:1.6}.codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:16px 0;padding:0;list-style:none}.codes li{border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px;text-align:center}.selectable{user-select:text}.codes code{user-select:all;color:var(--text)}.acknowledgement{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}footer{display:flex;justify-content:flex-end;margin-top:16px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}
</style>
