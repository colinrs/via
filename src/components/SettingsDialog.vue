<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { injectI18n, type Translate } from '../i18n'
import type { AppPreferences } from '../stores/via'

const props = withDefaults(defineProps<{
  open: boolean
  preferences: AppPreferences
  t?: Translate
  saving?: boolean
  masterPasswordChanging?: boolean
  masterPasswordConfigured?: boolean
  preferencesError?: string
  masterPasswordError?: string
  masterPasswordChangedToken?: number
}>(), {
  saving: false,
  masterPasswordChanging: false,
  masterPasswordConfigured: false,
  preferencesError: '',
  masterPasswordError: '',
  masterPasswordChangedToken: 0,
})

const emit = defineEmits<{
  updatePreferences: [preferences: AppPreferences]
  changeMasterPassword: [current: string, next: string]
  close: []
}>()
const t = props.t ?? injectI18n().t

const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const canChangePassword = computed(() => !props.masterPasswordChanging
  && currentPassword.value.trim().length > 0
  && newPassword.value.trim().length > 0
  && newPassword.value === confirmation.value)

function updatePreference<Key extends keyof AppPreferences>(key: Key, value: AppPreferences[Key]) {
  emit('updatePreferences', { ...props.preferences, [key]: value })
}

function clearPasswords() {
  currentPassword.value = ''
  newPassword.value = ''
  confirmation.value = ''
}

function close() {
  clearPasswords()
  emit('close')
}

function changeMasterPassword() {
  if (!canChangePassword.value) return
  emit('changeMasterPassword', currentPassword.value, newPassword.value)
}

watch(() => props.open, clearPasswords)
watch(() => props.masterPasswordChangedToken, clearPasswords)
</script>

<template>
  <div v-if="open" class="backdrop" role="dialog" aria-modal="true" :aria-label="t('settings.title')">
    <section class="dialog">
      <h2>{{ t('settings.title') }}</h2>

      <fieldset :disabled="saving" :aria-busy="saving">
        <legend>{{ t('settings.appearance') }}</legend>
        <label>
          {{ t('settings.language') }}
          <select
            :value="preferences.language"
            :aria-label="t('settings.language')"
            @change="updatePreference('language', ($event.target as HTMLSelectElement).value as AppPreferences['language'])"
          >
            <option value="system">{{ t('settings.language.system') }}</option>
            <option value="zh-CN">{{ t('settings.language.zh-CN') }}</option>
            <option value="en">{{ t('settings.language.en') }}</option>
          </select>
        </label>
        <label>
          {{ t('settings.fontSize') }}
          <select
            :value="preferences.fontSize"
            :aria-label="t('settings.fontSize')"
            @change="updatePreference('fontSize', ($event.target as HTMLSelectElement).value as AppPreferences['fontSize'])"
          >
            <option value="small">{{ t('settings.fontSize.small') }}</option>
            <option value="medium">{{ t('settings.fontSize.medium') }}</option>
            <option value="large">{{ t('settings.fontSize.large') }}</option>
          </select>
        </label>
        <label>
          {{ t('settings.theme') }}
          <select
            :value="preferences.theme"
            :aria-label="t('settings.theme')"
            @change="updatePreference('theme', ($event.target as HTMLSelectElement).value as AppPreferences['theme'])"
          >
            <option value="system">{{ t('settings.theme.system') }}</option>
            <option value="light">{{ t('settings.theme.light') }}</option>
            <option value="dark">{{ t('settings.theme.dark') }}</option>
          </select>
        </label>
        <p v-if="preferencesError" class="error" role="alert">{{ preferencesError }}</p>
      </fieldset>

      <fieldset v-if="masterPasswordConfigured" :disabled="masterPasswordChanging" :aria-busy="masterPasswordChanging">
        <legend>{{ t('settings.localCredentials') }}</legend>
        <label>
          {{ t('settings.currentMasterPassword') }}
          <input v-model="currentPassword" type="password" autocomplete="current-password" :aria-label="t('settings.currentMasterPassword')">
        </label>
        <label>
          {{ t('settings.newMasterPassword') }}
          <input v-model="newPassword" type="password" autocomplete="new-password" :aria-label="t('settings.newMasterPassword')">
        </label>
        <label>
          {{ t('settings.confirmNewMasterPassword') }}
          <input v-model="confirmation" type="password" autocomplete="new-password" :aria-label="t('settings.confirmNewMasterPassword')" @keyup.enter="changeMasterPassword">
        </label>
        <p v-if="masterPasswordError" class="error" role="alert">{{ masterPasswordError }}</p>
        <button
          data-testid="change-master-password"
          class="primary"
          type="button"
          :disabled="!canChangePassword"
          @click="changeMasterPassword"
        >{{ t('settings.changeMasterPassword') }}</button>
      </fieldset>

      <section class="about">
        <h3>{{ t('settings.about') }}</h3>
        <p>{{ t('settings.localOnly') }}</p>
        <p>{{ t('app.version') }}: {{ t('app.mvpVersion') }}</p>
      </section>

      <footer>
        <button data-testid="close-settings" type="button" @click="close">{{ t('common.close') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop{position:fixed;inset:0;display:grid;place-items:center;background:#0008;z-index:20}.dialog{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:20px;box-shadow:0 22px 80px #0008}.dialog h2{margin:0 0 16px;font-size:18px}fieldset{display:grid;gap:12px;border:1px solid var(--line);border-radius:8px;margin:0 0 16px;padding:14px}legend{padding:0 6px;font-size:13px;font-weight:700}label{display:grid;grid-template-columns:minmax(150px,1fr) minmax(180px,1fr);align-items:center;gap:12px;color:var(--muted);font-size:12px}input,select{width:100%;border:1px solid var(--line);border-radius:6px;background:var(--canvas);padding:8px;color:var(--text);font:inherit}.about h3{margin:0;font-size:13px}.about p{margin:8px 0;color:var(--muted);font-size:12px;line-height:1.5}.error{color:var(--red);font-size:12px}.primary{justify-self:end;background:#1f6feb}footer{display:flex;justify-content:flex-end;margin-top:16px}button{border:1px solid var(--line);border-radius:6px;background:var(--surface-raised);padding:7px 10px;color:var(--text);cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}@media (max-width:540px){label{grid-template-columns:1fr}}
</style>
