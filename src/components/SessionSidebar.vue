<script setup lang="ts">
import { ref, watch } from 'vue'

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
}>()
</script>

<template>
  <aside data-testid="session-sidebar" class="sidebar">
    <button class="primary-button create-session" type="button" @click="emit('create')">
      <span aria-hidden="true">＋</span> 新建 SSH 会话
    </button>
    <button class="create-group" type="button" @click="emit('createGroup')">＋ 新建分组</button>

    <nav class="session-navigation" aria-label="SSH 会话">
      <section v-for="group in groups" :key="group.id" class="session-group">
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
            <span class="session-indicator" :class="session.state" :aria-label="session.state" />
          </button>
        </div>
      </section>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar { display: flex; width: 248px; flex: 0 0 248px; flex-direction: column; border-right: 1px solid var(--line); background: var(--canvas); }
.create-session { margin: 14px 14px 7px; }.create-group{margin:0 14px 7px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:12px;text-align:left;cursor:pointer}.create-group:hover{color:var(--text)}
.session-navigation { overflow: auto; padding: 4px 10px 16px; }
.session-group { margin: 13px 0 20px; }
.group-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; border: 0; padding: 0 9px 6px; color: var(--muted); background: transparent; text-align: left; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.group-heading::before { content: '›'; display: inline-block; margin-right: 6px; transition: transform 160ms ease; }
.group-heading[aria-expanded='true']::before { transform: rotate(90deg); }
.group-name { display: flex; gap: 6px; align-items: center; }
.count { min-width: 18px; border-radius: 20px; background: var(--surface-raised); padding: 1px 6px; text-align: center; font-size: 10px; }
.tree-children { position: relative; margin-left: 12px; padding-left: 10px; }
.tree-children::before { position: absolute; top: 0; bottom: 8px; left: 0; width: 1px; background: var(--line); content: ''; }
.session-item { display: grid; width: 100%; grid-template-columns: 16px 1fr 8px; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 7px; padding: 8px; color: var(--muted); background: transparent; text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
.session-item:hover { background: var(--surface); color: var(--text); }
.session-item.selected { border-color: rgb(56 139 253 / 45%); background: var(--surface-raised); color: var(--text); box-shadow: 0 4px 12px rgb(0 0 0 / 12%); }
.server-icon { color: var(--blue); }.session-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-indicator { width: 7px; height: 7px; border-radius: 50%; background: #484f58; }.session-indicator.active { background: var(--green); box-shadow: 0 0 7px var(--green); }.session-indicator.failed { background: var(--red); }.session-indicator.stopped { background: #484f58; }
</style>
