import { createI18n, i18nInjectionKey } from '../i18n'

export function withChineseI18n() {
  return {
    global: {
      provide: {
        [i18nInjectionKey as symbol]: createI18n('zh-CN'),
      },
    },
  }
}
