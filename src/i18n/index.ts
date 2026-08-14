import { ref, type Ref } from 'vue'

import type { AppPreferences } from '../stores/via'
import { catalogs, type TranslationKey } from './catalog'

export type SupportedLocale = keyof typeof catalogs
export type LanguagePreference = AppPreferences['language']
type PlaceholderNames<Value extends string> = Value extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never

export type TranslationParams<Key extends TranslationKey> = [PlaceholderNames<(typeof catalogs.en)[Key]>] extends [never]
  ? never
  : { [Name in PlaceholderNames<(typeof catalogs.en)[Key]>]: string | number }

type TranslationArguments<Key extends TranslationKey> = [TranslationParams<Key>] extends [never]
  ? []
  : [params: TranslationParams<Key>]

export type Translate = <Key extends TranslationKey>(key: Key, ...args: TranslationArguments<Key>) => string

export function resolveSystemLanguage(language: LanguagePreference, navigatorLanguage?: string): SupportedLocale {
  if (language === 'zh-CN' || language === 'en') return language
  return /^zh(?:[-_]|$)/i.test(navigatorLanguage ?? '') ? 'zh-CN' : 'en'
}

function browserLanguage(): string | undefined {
  return typeof globalThis.navigator === 'undefined' ? undefined : globalThis.navigator.language
}

export interface I18n {
  locale: Ref<SupportedLocale>
  t: Translate
  setLanguage: (language: LanguagePreference, navigatorLanguage?: string) => void
}

export function createI18n(initial: LanguagePreference, navigatorLanguage = browserLanguage()): I18n {
  const locale = ref(resolveSystemLanguage(initial, navigatorLanguage))

  return {
    locale,
    t(key, ...args) {
      const message = catalogs[locale.value][key]
      const params = args[0] as Record<string, string | number> | undefined
      return params ? message.replace(/\{([^}]+)\}/g, (_placeholder, name: string) => String(params[name])) : message
    },
    setLanguage(language, nextNavigatorLanguage = browserLanguage()) {
      locale.value = resolveSystemLanguage(language, nextNavigatorLanguage)
    },
  }
}
