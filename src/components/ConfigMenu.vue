<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { injectI18n } from '../i18n'

type Action = 'import' | 'export' | 'unlock' | 'settings'

const emit = defineEmits<{
  import: []
  export: []
  unlock: []
  settings: []
}>()
const { t } = injectI18n()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle() { open.value = !open.value }
function close() { open.value = false }
function choose(action: Action) {
  if (action === 'import') emit('import')
  else if (action === 'export') emit('export')
  else if (action === 'unlock') emit('unlock')
  else emit('settings')
  close()
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="config-menu">
    <button type="button" data-testid="config-button" class="config-button" :aria-label="t('action.configMenu')" :aria-expanded="open" @click="toggle">⚙</button>
    <div v-if="open" data-testid="config-menu" class="menu" role="menu">
      <button type="button" role="menuitem" data-testid="config-import" @click="choose('import')">{{ t('action.importConfig') }}</button>
      <button type="button" role="menuitem" data-testid="config-export" @click="choose('export')">{{ t('action.exportConfig') }}</button>
      <button type="button" role="menuitem" data-testid="config-unlock" @click="choose('unlock')">{{ t('action.unlockCredentials') }}</button>
      <button type="button" role="menuitem" data-testid="config-settings" @click="choose('settings')">{{ t('app.settings') }}</button>
    </div>
  </div>
</template>

<style scoped>
.config-menu { position: relative; display: inline-flex; }
.config-button { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-raised); color: var(--text); font-size: 14px; cursor: pointer; }
.config-button:hover { border-color: var(--muted); }
.menu { position: absolute; bottom: 34px; left: 0; z-index: 90; display: flex; min-width: 190px; flex-direction: column; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-raised); padding: 5px; box-shadow: 0 10px 30px rgb(0 0 0 / 40%); }
.menu button { border: 0; border-radius: 7px; padding: 8px 10px; background: transparent; color: var(--text); text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.menu button:hover { background: var(--surface); }
</style>
