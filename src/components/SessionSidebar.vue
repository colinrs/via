<script setup lang="ts">
import { ref, watch } from 'vue'

import { injectI18n } from '../i18n'

export interface SessionItem {
  id: string
  name: string
  state: 'active' | 'failed' | 'stopped'
}

export interface SessionGroup {
  id: string
  name: string
  icon: string
  sessions: SessionItem[]
}

const props = defineProps<{
  groups: SessionGroup[]
  selectedSessionId: string
}>()

const expandedGroupIds = ref(new Set<string>())
const knownGroupIds = new Set<string>()
const { t } = injectI18n()

watch(() => props.groups.map((group) => group.id), (groupIds) => {
  for (const groupId of groupIds) {
    if (!knownGroupIds.has(groupId)) expandedGroupIds.value.add(groupId)
    knownGroupIds.add(groupId)
  }
}, { immediate: true })

watch(() => props.selectedSessionId, (sessionId) => {
  const parent = props.groups.find((group) => group.sessions.some((session) => session.id === sessionId))
  if (parent) expandedGroupIds.value.add(parent.id)
})

function isExpanded(groupId: string) { return expandedGroupIds.value.has(groupId) }
function toggleGroup(groupId: string) {
  if (isExpanded(groupId)) expandedGroupIds.value.delete(groupId)
  else expandedGroupIds.value.add(groupId)
}

const emit = defineEmits<{
  select: [id: string]
  create: []
  createGroup: []
  deleteGroup: [id: string]
}>()
</script>

<template>
  <aside data-testid="session-sidebar" class="sidebar">
    <button class="primary-button create-session" type="button" @click="emit('create')">
      <span aria-hidden="true">＋</span> {{ t('action.newSshSession') }}
    </button>
    <button class="create-group" type="button" @click="emit('createGroup')"><span aria-hidden="true">＋</span> {{ t('action.newGroup') }}</button>

    <nav class="session-navigation" :aria-label="t('sidebar.navigation')">
      <section v-for="group in groups" :key="group.id" class="session-group">
        <div class="group-heading-row">
          <button
            :data-testid="`group-toggle-${group.id}`"
            class="group-heading"
            type="button"
            :aria-expanded="isExpanded(group.id)"
            @click="toggleGroup(group.id)"
          >
            <span class="group-name"><span aria-hidden="true">{{ group.icon }}</span>{{ group.name }}</span>
            <span class="count">{{ group.sessions.length }}</span>
          </button>
          <button
            :data-testid="`delete-group-${group.id}`"
            class="delete-group"
            type="button"
            :aria-label="t('aria.deleteGroup', { name: group.name })"
            :title="t('sidebar.deleteGroup')"
            @click.stop="emit('deleteGroup', group.id)"
          >⌫</button>
        </div>
        <div v-if="isExpanded(group.id)" class="tree-children">
          <button
            v-for="session in group.sessions"
            :key="session.id"
            :data-testid="`session-child-${session.id}`"
            type="button"
            class="session-item"
            :class="{ selected: session.id === selectedSessionId }"
            @click="emit('select', session.id)"
          >
            <span class="server-icon" aria-hidden="true">▣</span>
            <span class="session-name">{{ session.name }}</span>
            <span class="session-indicator" :class="session.state" :aria-label="t(`state.${session.state}`)" />
          </button>
        </div>
      </section>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar { display: flex; width: 248px; flex: 0 0 248px; flex-direction: column; border-right: 1px solid var(--line); background: var(--canvas); }
.create-session { margin: 14px 14px 7px; }
.create-group { margin: 0 14px 7px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; text-align: left; cursor: pointer; box-shadow: none; }
.create-group:hover { color: var(--text); }
.session-navigation { overflow: auto; padding: 4px 10px 16px; }
.session-group { margin: 13px 0 20px; }
.group-heading-row { display: flex; align-items: center; }
.group-heading { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: space-between; border: 0; padding: 0 5px 6px 9px; color: var(--muted); background: transparent; text-align: left; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: none; }
.group-heading::before { content: '›'; display: inline-block; margin-right: 6px; transition: transform 160ms ease; }
.group-heading[aria-expanded='true']::before { transform: rotate(90deg); }
.group-name { display: flex; gap: 6px; align-items: center; }
.count { min-width: 18px; background: var(--surface); border: 1px solid var(--line); padding: 1px 6px; text-align: center; font-size: 10px; border-radius: var(--radius-sm); }
.delete-group { border: 0; padding: 0 7px 6px 3px; color: var(--muted); background: transparent; font: inherit; font-size: 15px; cursor: pointer; box-shadow: none; }
.delete-group:hover { color: var(--red); }
.tree-children { position: relative; margin-left: 12px; padding-left: 10px; }
.tree-children::before { position: absolute; top: 0; bottom: 8px; left: 0; width: 1px; background: #808080; content: ''; }
.session-item { display: grid; width: 100%; grid-template-columns: 16px 1fr 8px; align-items: center; gap: 8px; border: 1px solid transparent; padding: 8px; color: var(--muted); background: transparent; text-align: left; font: inherit; font-size: 12px; cursor: pointer; box-shadow: none; border-radius: var(--radius-sm); }
.session-item:hover { background: var(--surface); color: var(--text); }
.session-item.selected { background: #000000; color: #ffffff; }
.server-icon { color: var(--text); }
.session-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-indicator { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.session-indicator.active { background: var(--green); }
.session-indicator.failed { background: var(--red); }
.session-indicator.stopped { background: var(--muted); }
</style>
