<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { injectI18n } from '../i18n'
import type { LocalForwardRule, TunnelState } from '../types/via'

const props = defineProps<{ rules: LocalForwardRule[] }>()
const emit = defineEmits<{
  add: []
  update: [rule: LocalForwardRule]
  toggle: [rule: LocalForwardRule]
  remove: [id: string]
  clone: [id: string]
  startAll: []
  stopAll: []
}>()
const { t } = injectI18n()

const query = ref('')
const scrollTop = ref(0)
const rowHeight = 46
const windowSize = 32
const filteredRules = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return props.rules
  return props.rules.filter((rule) => [rule.localPort, rule.targetHost, rule.targetPort, rule.note].join(' ').toLowerCase().includes(keyword))
})
const firstVisible = computed(() => Math.floor(scrollTop.value / rowHeight))
const visibleRules = computed(() => filteredRules.value.slice(firstVisible.value, firstVisible.value + windowSize))
const tableHeight = computed(() => `${Math.max(1, filteredRules.value.length) * rowHeight + 42}px`)
const tableOffset = computed(() => `${firstVisible.value * rowHeight}px`)
watch(query, () => { scrollTop.value = 0 })

const stateLabel = (state: TunnelState) => t(`state.${state}`)
const stateClass = (state: TunnelState) => `state-${state}`
const patch = (rule: LocalForwardRule, fields: Partial<LocalForwardRule>) => emit('update', { ...rule, ...fields })
const onScroll = (event: Event) => { scrollTop.value = (event.target as HTMLElement).scrollTop }
</script>

<template>
  <section data-testid="tunnel-grid" class="grid-section">
    <div class="toolbar">
      <div class="toolbar-actions">
        <button class="primary-button" type="button" @click="emit('add')">{{ t('action.addRule') }}</button>
        <button class="success-button" type="button" @click="emit('startAll')">{{ t('action.startAll') }}</button>
        <button class="secondary-button" type="button" @click="emit('stopAll')">{{ t('action.stopAll') }}</button>
      </div>
      <label class="search"><span aria-hidden="true">⌕</span><input v-model="query" :placeholder="t('placeholder.searchRules')" /></label>
    </div>

    <div class="table-scroll" @scroll="onScroll">
      <table :style="{ minHeight: tableHeight }">
        <thead><tr><th>{{ t('table.status') }}</th><th>{{ t('table.toggle') }}</th><th>{{ t('field.localPort') }}</th><th>{{ t('field.targetHost') }}</th><th>{{ t('field.targetPort') }}</th><th>{{ t('field.note') }}</th><th>{{ t('table.actions') }}</th></tr></thead>
        <tbody :style="{ transform: `translateY(${tableOffset})` }">
          <tr v-for="rule in visibleRules" :key="rule.id" :class="{ conflict: rule.runtimeState === 'conflict' }">
            <td><span class="state" :class="stateClass(rule.runtimeState)"><i />{{ stateLabel(rule.runtimeState) }}</span></td>
            <td class="center"><label class="switch"><input :checked="rule.enabled" type="checkbox" @change="emit('toggle', { ...rule, enabled: !rule.enabled })" /><span /></label></td>
            <td><input class="port-input" :value="rule.localPort" type="number" min="1" max="65535" :aria-label="t('field.localPort')" @change="patch(rule, { localPort: Number(($event.target as HTMLInputElement).value) })" /></td>
            <td><input :value="rule.targetHost" :aria-label="t('field.targetHost')" @change="patch(rule, { targetHost: ($event.target as HTMLInputElement).value })" /></td>
            <td><input class="port-input" :value="rule.targetPort" type="number" min="1" max="65535" :aria-label="t('field.targetPort')" @change="patch(rule, { targetPort: Number(($event.target as HTMLInputElement).value) })" /></td>
            <td><input :value="rule.note" :aria-label="t('field.note')" @change="patch(rule, { note: ($event.target as HTMLInputElement).value })" /></td>
            <td class="row-actions"><button type="button" :title="t('action.cloneRule')" @click="emit('clone', rule.id)">⧉</button><button class="danger-icon" type="button" :title="t('action.deleteRule')" @click="emit('remove', rule.id)">⌫</button></td>
          </tr>
          <tr v-if="filteredRules.length === 0"><td class="empty" colspan="7">{{ t('message.noMatchingRules') }}</td></tr>
        </tbody>
      </table>
    </div>
    <p v-if="rules.some((rule) => rule.runtimeState === 'conflict')" class="diagnostic"><strong>{{ t('message.portConflictTitle') }}</strong>{{ t('message.portConflict') }}</p>
  </section>
</template>

<style scoped>
.grid-section { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); padding: 12px 18px; }.toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; }.search { display: flex; width: min(310px, 100%); align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 0 9px; color: var(--muted); }.search input { border: 0; padding: 7px 0; }
.table-scroll { min-height: 0; overflow: auto; padding: 18px; } table { width: 100%; min-width: 830px; border: 1px solid var(--line); border-spacing: 0; border-radius: 8px; overflow: hidden; background: rgb(22 27 34 / 55%); } tbody { display: table-row-group; } th { border-bottom: 1px solid var(--line); padding: 11px 12px; color: var(--muted); background: var(--surface); text-align: left; font-size: 11px; font-weight: 650; } td { height: 46px; border-bottom: 1px solid rgb(48 54 61 / 70%); padding: 8px 10px; } tr:last-child td { border-bottom: 0; } tr:hover { background: rgb(48 54 61 / 28%); } tr.conflict { background: rgb(248 81 73 / 7%); }.center { text-align: center; }
.state { display: inline-flex; align-items: center; gap: 5px; border: 1px solid; border-radius: 999px; padding: 3px 7px; font-size: 10px; white-space: nowrap; }.state i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }.state-active { color: var(--green); border-color: rgb(63 185 80 / 35%); background: rgb(63 185 80 / 10%); }.state-conflict,.state-failed { color: var(--red); border-color: rgb(248 81 73 / 35%); background: rgb(248 81 73 / 10%); }.state-stopped { color: var(--muted); border-color: var(--line); }.state-starting,.state-reconnecting { color: var(--yellow); border-color: rgb(210 153 34 / 35%); }
input { width: 100%; border: 1px solid transparent; border-radius: 4px; outline: 0; background: transparent; padding: 5px 6px; color: var(--text); font: inherit; font-size: 12px; } input:hover { border-color: var(--line); } input:focus { border-color: var(--blue); background: var(--canvas); }.port-input { width: 80px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }.switch { position: relative; display: inline-block; width: 30px; height: 17px; }.switch input { position: absolute; opacity: 0; }.switch span { display: block; width: 100%; height: 100%; border-radius: 999px; background: #484f58; cursor: pointer; }.switch span::after { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #f0f6fc; content: ''; transition: transform .15s; }.switch input:checked + span { background: var(--blue); }.switch input:checked + span::after { transform: translateX(13px); }.row-actions { white-space: nowrap; }.row-actions button { border: 0; background: transparent; color: var(--muted); font-size: 17px; cursor: pointer; }.row-actions button:hover { color: var(--text); }.row-actions .danger-icon:hover { color: var(--red); }.empty { padding: 40px; color: var(--muted); text-align: center; }.diagnostic { margin: 0 18px 18px; border: 1px solid rgb(248 81 73 / 30%); border-radius: 6px; background: rgb(248 81 73 / 9%); padding: 10px 12px; color: #ff9b95; font-size: 12px; }
@media (max-width: 800px) { .toolbar { align-items: stretch; flex-direction: column; }.search { width: 100%; } }
</style>
