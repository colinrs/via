<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { injectI18n } from '../i18n'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; create: [name: string] }>()
const name = ref('')
const normalizedName = computed(() => name.value.trim())
const { t } = injectI18n()
watch(() => props.open, (open) => { if (open) name.value = '' })
</script>
<template><div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="t('dialog.newGroup.title')"><section class="dialog"><h2>{{ t('dialog.newGroup.title') }}</h2><p>{{ t('dialog.newGroup.description') }}</p><label>{{ t('field.groupName') }}<input v-model="name" :aria-label="t('field.groupName')" autofocus @keyup.enter="normalizedName && emit('create', normalizedName)" /></label><footer><button type="button" @click="emit('close')">{{ t('common.cancel') }}</button><button data-testid="create-group-action" class="primary" type="button" :disabled="!normalizedName" @click="emit('create', normalizedName)">{{ t('action.createGroup') }}</button></footer></section></div></template>
<style scoped>.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(400px,calc(100vw - 32px));border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0;font-size:16px}.dialog p{color:var(--muted);font-size:13px;line-height:1.6}.dialog label{display:grid;gap:6px;color:var(--muted);font-size:12px}.dialog input{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--canvas);padding:8px;color:var(--text)}footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}.primary{background:#1f6feb}.primary:disabled{cursor:not-allowed;opacity:.55}</style>
