<script setup lang="ts">
const emit = defineEmits<{ create: [] }>()
</script>

<template>
  <section class="empty-workspace" data-testid="empty-workspace">
    <div class="empty-icon" aria-hidden="true">⇄</div>
    <h1>还没有 SSH 会话</h1>
    <p>新建一个 SSH 会话，然后添加仅绑定到 127.0.0.1 的 Local 转发规则。</p>
    <button class="primary-button" type="button" @click="emit('create')">＋ 新建 SSH 会话</button>
  </section>
</template>

<style scoped>
.empty-workspace { display: grid; flex: 1; place-content: center; justify-items: center; gap: 10px; padding: 48px; text-align: center; }
.empty-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--blue); font-size: 25px; }
h1 { margin: 6px 0 0; font-size: 18px; } p { max-width: 390px; margin: 0 0 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
</style>
