<script setup lang="ts">
import { computed, ref, watch } from 'vue'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; create: [name: string] }>()
const name = ref('')
const normalizedName = computed(() => name.value.trim())
watch(() => props.open, (open) => { if (open) name.value = '' })
</script>
<template><div v-if="open" class="backdrop" role="dialog" aria-modal="true" aria-label="新建分组"><section class="dialog"><h2>新建分组</h2><p>分组用于整理 SSH 会话，例如“开发环境”或“生产环境”。</p><label>分组名称<input v-model="name" aria-label="分组名称" autofocus @keyup.enter="normalizedName && emit('create', normalizedName)" /></label><footer><button type="button" @click="emit('close')">取消</button><button data-testid="create-group-action" class="primary" type="button" :disabled="!normalizedName" @click="emit('create', normalizedName)">创建分组</button></footer></section></div></template>
<style scoped>.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(400px,calc(100vw - 32px));border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}.dialog label{display:grid;gap:6px;color:var(--muted);font-size:12px}.dialog input{border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}</style>
