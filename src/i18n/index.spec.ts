import { describe, expect, it } from 'vitest'

import { catalogs, translationKeys } from './catalog'
import { createI18n, resolveSystemLanguage } from '.'

if (false) {
  const { t } = createI18n('en')
  // @ts-expect-error status requires both placeholders
  t('status.tunnels', { active: 1 })
  // @ts-expect-error interpolation-free strings do not accept parameters
  t('settings.title', {})
  // @ts-expect-error object literals cannot add unknown interpolation keys
  t('status.tunnels', { active: 1, errors: 0, extra: 2 })
}

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

  it('interpolates the typed deletion and tunnel-status values in both locales', () => {
    const english = createI18n('en')
    const chinese = createI18n('zh-CN')

    expect(english.t('message.deleteGroupScope', { sessions: 2, rules: 3 })).toBe('This will delete 2 sessions and 3 forwarding rules in this group. This cannot be undone.')
    expect(chinese.t('message.deleteGroupScope', { sessions: 2, rules: 3 })).toBe('将删除此分组下的 2 个会话和 3 条转发规则，此操作不可撤销。')
    expect(english.t('status.tunnels', { active: 4, errors: 1 })).toBe('Tunnels: 4 running / 1 issues')
    expect(chinese.t('status.tunnels', { active: 4, errors: 1 })).toBe('隧道：4 运行中 / 1 异常')
  })

  it('provides every key in both language catalogs', () => {
    for (const key of translationKeys) {
      expect(catalogs.en[key]).toEqual(expect.any(String))
      expect(catalogs['zh-CN'][key]).toEqual(expect.any(String))
      expect(catalogs.en[key].match(/\{[^}]+\}/g)?.sort()).toEqual(catalogs['zh-CN'][key].match(/\{[^}]+\}/g)?.sort())
    }
  })

  it('includes current table and accessible-label copy in the typed catalog', () => {
    expect(translationKeys).toEqual(expect.arrayContaining([
      'table.status',
      'table.toggle',
      'table.actions',
      'aria.deleteGroup',
    ]))
    expect(createI18n('en').t('aria.deleteGroup', { name: 'Production' })).toBe('Delete group Production')
    expect(createI18n('zh-CN').t('aria.deleteGroup', { name: '生产环境' })).toBe('删除分组 生产环境')
  })
})
