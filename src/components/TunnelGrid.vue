<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { injectI18n } from '../i18n'
import type { LocalForwardRule, TunnelState } from '../types/via'

const props = withDefaults(
  defineProps<{
    rules: LocalForwardRule[]
    bulkBusy?: boolean
    sessionConnected?: boolean
  }>(),
  {
    bulkBusy: false,
    sessionConnected: true,
  }
)
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
  return props.rules.filter((rule) =>
    [rule.localPort, rule.targetHost, rule.targetPort, rule.note]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  )
})
const firstVisible = computed(() => Math.floor(scrollTop.value / rowHeight))
const visibleRules = computed(() =>
  filteredRules.value.slice(firstVisible.value, firstVisible.value + windowSize)
)
const tableHeight = computed(
  () => `${Math.max(1, filteredRules.value.length) * rowHeight + 42}px`
)
const tableOffset = computed(() => `${firstVisible.value * rowHeight}px`)
watch(query, () => {
  scrollTop.value = 0
})

const stateLabel = (state: TunnelState) => t(`state.${state}`)
const stateClass = (state: TunnelState) => `state-${state}`
const patch = (rule: LocalForwardRule, fields: Partial<LocalForwardRule>) =>
  emit('update', { ...rule, ...fields })
const onScroll = (event: Event) => {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}

const startAllHint = computed(() =>
  props.bulkBusy
    ? t('hint.operationInProgress')
    : !props.sessionConnected
      ? t('hint.connectSessionFirst')
      : ''
)
const stopAllHint = computed(() =>
  props.bulkBusy ? t('hint.operationInProgress') : ''
)
</script>

<template>
  <section data-testid="tunnel-grid" class="grid-section">
    <div class="toolbar">
      <div class="toolbar-actions">
        <button class="primary-button" type="button" @click="emit('add')">
          {{ t('action.addRule') }}
        </button>
        <span class="button-wrap" :title="startAllHint || undefined"
          ><button
            class="success-button"
            type="button"
            :aria-description="startAllHint || undefined"
            :disabled="bulkBusy || !sessionConnected"
            @click="emit('startAll')"
          >
            {{ t('action.startAll') }}
          </button></span
        >
        <span
          v-if="rules.some((rule) => rule.runtimeState !== 'stopped')"
          class="button-wrap"
          :title="stopAllHint || undefined"
          ><button
            class="secondary-button"
            type="button"
            :aria-description="stopAllHint || undefined"
            :disabled="bulkBusy"
            @click="emit('stopAll')"
          >
            {{ t('action.stopAll') }}
          </button></span
        >
      </div>
      <label class="search"
        ><span aria-hidden="true">⌕</span
        ><input v-model="query" :placeholder="t('placeholder.searchRules')"
      /></label>
    </div>

    <div class="table-scroll" @scroll="onScroll">
      <table :style="{ minHeight: tableHeight }">
        <thead>
          <tr>
            <th>{{ t('table.status') }}</th>
            <th>{{ t('table.toggle') }}</th>
            <th>{{ t('field.localPort') }}</th>
            <th>{{ t('field.targetHost') }}</th>
            <th>{{ t('field.targetPort') }}</th>
            <th>{{ t('field.note') }}</th>
            <th>{{ t('table.actions') }}</th>
          </tr>
        </thead>
        <tbody :style="{ transform: `translateY(${tableOffset})` }">
          <tr
            v-for="rule in visibleRules"
            :key="rule.id"
            :class="{ conflict: rule.runtimeState === 'conflict' }"
          >
            <td>
              <span class="state" :class="stateClass(rule.runtimeState)"
                ><i />{{ stateLabel(rule.runtimeState) }}</span
              >
            </td>
            <td class="center">
              <label class="switch"
                ><input
                  :checked="rule.enabled"
                  type="checkbox"
                  @change="
                    emit('toggle', { ...rule, enabled: !rule.enabled })
                  " /><span
              /></label>
            </td>
            <td>
              <input
                class="port-input"
                :value="rule.localPort"
                type="number"
                min="1"
                max="65535"
                :aria-label="t('field.localPort')"
                @change="
                  patch(rule, {
                    localPort: Number(
                      ($event.target as HTMLInputElement).value
                    ),
                  })
                "
              />
            </td>
            <td>
              <input
                :value="rule.targetHost"
                :aria-label="t('field.targetHost')"
                @change="
                  patch(rule, {
                    targetHost: ($event.target as HTMLInputElement).value,
                  })
                "
              />
            </td>
            <td>
              <input
                class="port-input"
                :value="rule.targetPort"
                type="number"
                min="1"
                max="65535"
                :aria-label="t('field.targetPort')"
                @change="
                  patch(rule, {
                    targetPort: Number(
                      ($event.target as HTMLInputElement).value
                    ),
                  })
                "
              />
            </td>
            <td>
              <input
                :value="rule.note"
                :aria-label="t('field.note')"
                @change="
                  patch(rule, {
                    note: ($event.target as HTMLInputElement).value,
                  })
                "
              />
            </td>
            <td class="row-actions">
              <button
                type="button"
                :title="t('action.cloneRule')"
                @click="emit('clone', rule.id)"
              >
                ⧉</button
              ><button
                class="danger-icon"
                type="button"
                :title="t('action.deleteRule')"
                @click="emit('remove', rule.id)"
              >
                ⌫
              </button>
            </td>
          </tr>
          <tr v-if="filteredRules.length === 0">
            <td class="empty" colspan="7">
              {{ t('message.noMatchingRules') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p
      v-if="rules.some((rule) => rule.runtimeState === 'conflict')"
      class="diagnostic"
    >
      <strong>{{ t('message.portConflictTitle') }}</strong
      >{{ t('message.portConflict') }}
    </p>
  </section>
</template>

<style scoped>
.button-wrap {
  display: inline-flex;
}
.grid-section {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  padding: 12px 18px;
}
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.search {
  display: flex;
  width: min(310px, 100%);
  align-items: center;
  gap: 7px;
  border: 1px solid var(--line);
  background: var(--content);
  padding: 0 9px;
  color: var(--muted);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset);
}
.search input {
  border: 0;
  padding: 7px 0;
  color: var(--text);
  background: transparent;
}

.table-scroll {
  min-height: 0;
  overflow: auto;
  padding: 18px;
}
table {
  width: 100%;
  min-width: 830px;
  border: 1px solid var(--line);
  border-spacing: 0;
  background: var(--content);
  border-radius: var(--radius-md);
  overflow: hidden;
}
th {
  border-bottom: 1px solid var(--line);
  padding: 11px 12px;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
}
td {
  height: 46px;
  border-bottom: 1px solid #c0c0c0;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
}
tr:last-child td {
  border-bottom: 0;
}
tr:hover {
  background: #ececec;
}
tr.conflict {
  background: rgb(179 38 30 / 8%);
}
.center {
  text-align: center;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line);
  padding: 2px 6px;
  color: var(--text);
  background: var(--surface);
  font-family: var(--font-ui);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-raised);
}
.state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
}
.state-active i {
  background: var(--green);
}
.state-conflict i,
.state-failed i {
  background: var(--red);
}
.state-stopped i {
  background: var(--muted);
}
.state-starting i,
.state-reconnecting i {
  background: var(--yellow);
}

input {
  width: 100%;
  border: 1px solid transparent;
  outline: 0;
  background: transparent;
  padding: 5px 6px;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
}
input:hover {
  border-color: #c0c0c0;
}
input:focus {
  border-color: var(--line);
  background: var(--content);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset);
}
.port-input {
  width: 80px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 16px;
}
.switch input {
  position: absolute;
  opacity: 0;
}
.switch span {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--content);
  border: 1px solid var(--line);
  cursor: pointer;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset);
}
.switch input:checked + span::after {
  content: '✓';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
}

.row-actions {
  white-space: nowrap;
}
.row-actions button {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 17px;
  cursor: pointer;
  box-shadow: none;
}
.row-actions button:hover {
  color: var(--text);
}
.row-actions .danger-icon:hover {
  color: var(--red);
}
.empty {
  padding: 40px;
  color: var(--muted);
  text-align: center;
}
.diagnostic {
  margin: 0 18px 18px;
  border: 1px solid var(--red);
  background: rgb(179 38 30 / 8%);
  padding: 10px 12px;
  color: var(--red);
  font-size: 12px;
}

@media (max-width: 800px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .search {
    width: 100%;
  }
}
</style>
