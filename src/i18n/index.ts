import { ref, type Ref } from 'vue'

import type { AppPreferences } from '../stores/via'
import { catalogs, type TranslationKey } from './catalog'

export type SupportedLocale = keyof typeof catalogs
export type LanguagePreference = AppPreferences['language']

export function resolveSystemLanguage(language: LanguagePreference, navigatorLanguage?: string): SupportedLocale {
  if (language === 'zh-CN' || language === 'en') return language
  return /^zh(?:[-_]|$)/i.test(navigatorLanguage ?? '') ? 'zh-CN' : 'en'
}

function browserLanguage(): string | undefined {
  return typeof globalThis.navigator === 'undefined' ? undefined : globalThis.navigator.language
}

export interface I18n {
  locale: Ref<SupportedLocale>
  t: (key: TranslationKey) => string
  setLanguage: (language: LanguagePreference, navigatorLanguage?: string) => void
}

export function createI18n(initial: LanguagePreference, navigatorLanguage = browserLanguage()): I18n {
  const locale = ref(resolveSystemLanguage(initial, navigatorLanguage))

  return {
    locale,
    t(key) {
      return catalogs[locale.value][key] ?? key
    },
    setLanguage(language, nextNavigatorLanguage = browserLanguage()) {
      locale.value = resolveSystemLanguage(language, nextNavigatorLanguage)
    },
  }
}
