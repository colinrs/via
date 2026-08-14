import { describe, expect, it } from 'vitest'

import { catalogs, translationKeys } from './catalog'
import { createI18n, resolveSystemLanguage } from '.'

describe('i18n', () => {
  it('resolves system Chinese variants and translates the same key in both catalogs', () => {
    expect(resolveSystemLanguage('system', 'zh-Hans-CN')).toBe('zh-CN')
    expect(resolveSystemLanguage('system', 'zh_Hans')).toBe('zh-CN')
    expect(resolveSystemLanguage('system', 'en-GB')).toBe('en')
    expect(resolveSystemLanguage('system', undefined)).toBe('en')
    expect(resolveSystemLanguage('zh-CN', 'en-US')).toBe('zh-CN')
    expect(createI18n('zh-CN').t('settings.title')).toBe('设置')
    expect(createI18n('en').t('settings.title')).toBe('Settings')
  })

  it('keeps locale state scoped to its own i18n instance', () => {
    const first = createI18n('en')
    const second = createI18n('zh-CN')

    first.setLanguage('zh-CN')

    expect(first.locale.value).toBe('zh-CN')
    expect(second.locale.value).toBe('zh-CN')
    second.setLanguage('en')
    expect(first.locale.value).toBe('zh-CN')
  })

  it('provides every key in both language catalogs', () => {
    for (const key of translationKeys) {
      expect(catalogs.en[key]).toEqual(expect.any(String))
      expect(catalogs['zh-CN'][key]).toEqual(expect.any(String))
    }
  })
})
