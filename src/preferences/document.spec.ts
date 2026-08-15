import { afterEach, describe, expect, it } from 'vitest'

import { applyDocumentPreferences } from './document'

afterEach(() => {
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-font-size')
  document.documentElement.removeAttribute('style')
})

describe('applyDocumentPreferences', () => {
  it('applies the mac theme palette, language, and font-size tokens', () => {
    const cleanup = applyDocumentPreferences(
      { language: 'system', fontSize: 'large', theme: 'system' },
      { navigator: { language: 'zh-Hans-CN' } },
      document
    )

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.dataset.theme).toBe('mac')
    expect(document.documentElement.dataset.fontSize).toBe('large')
    expect(
      document.documentElement.style.getPropertyValue('--app-font-scale')
    ).toBe('1.125')
    expect(document.documentElement.style.zoom).toBe('1.125')
    expect(document.documentElement.style.fontSize).toBe('')
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(
      '#c6c6c6'
    )
    expect(document.documentElement.style.getPropertyValue('--content')).toBe(
      '#ffffff'
    )
    expect(document.documentElement.style.getPropertyValue('--text')).toBe(
      '#000000'
    )
    expect(document.documentElement.style.color).toBe('var(--text)')
    expect(document.documentElement.style.backgroundColor).toBe('var(--canvas)')

    cleanup()
  })

  it('ignores the theme value and always applies mac', () => {
    applyDocumentPreferences(
      { language: 'en', fontSize: 'small', theme: 'dark' },
      { navigator: { language: 'en-US' } },
      document
    )

    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dataset.theme).toBe('mac')
    expect(
      document.documentElement.style.getPropertyValue('--app-font-scale')
    ).toBe('.875')
    expect(document.documentElement.style.zoom).toBe('0.875')
  })
})
