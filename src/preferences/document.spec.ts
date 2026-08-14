import { afterEach, describe, expect, it } from 'vitest'

import { applyDocumentPreferences } from './document'

interface FakeMediaQueryList {
  matches: boolean
  addEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  removeEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  dispatch(matches: boolean): void
}

function fakeMedia(matches: boolean): FakeMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  return {
    matches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    dispatch(nextMatches) {
      this.matches = nextMatches
      for (const listener of listeners) listener({ matches: nextMatches } as MediaQueryListEvent)
    },
  }
}

function legacyMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  return {
    matches,
    addListener(listener: (event: MediaQueryListEvent) => void) { listeners.add(listener) },
    removeListener(listener: (event: MediaQueryListEvent) => void) { listeners.delete(listener) },
    dispatch(nextMatches: boolean) {
      this.matches = nextMatches
      for (const listener of listeners) listener({ matches: nextMatches } as MediaQueryListEvent)
    },
    get listenerCount() { return listeners.size },
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-font-size')
  document.documentElement.removeAttribute('style')
})

describe('applyDocumentPreferences', () => {
  it('uses system theme live and applies font size tokens', () => {
    const darkMedia = fakeMedia(true)
    const fakeWindow = {
      navigator: { language: 'zh-Hans-CN' },
      matchMedia: () => darkMedia,
    }

    const cleanup = applyDocumentPreferences(
      { language: 'system', fontSize: 'large', theme: 'system' },
      fakeWindow,
      document,
    )

    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.fontSize).toBe('large')
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.125')
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#0d1117')

    darkMedia.dispatch(false)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#f6f8fa')
    expect(document.documentElement.style.color).toBe('var(--text)')
    expect(document.documentElement.style.backgroundColor).toBe('var(--canvas)')

    cleanup()
    cleanup()
    darkMedia.dispatch(true)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not follow system updates when an explicit theme is selected', () => {
    const darkMedia = fakeMedia(false)
    let registrations = 0
    const addEventListener = darkMedia.addEventListener
    darkMedia.addEventListener = (type, listener) => { registrations += 1; addEventListener(type, listener) }
    const fakeWindow = {
      navigator: { language: 'en-US' },
      matchMedia: () => darkMedia,
    }

    const cleanup = applyDocumentPreferences(
      { language: 'en', fontSize: 'small', theme: 'dark' },
      fakeWindow,
      document,
    )

    darkMedia.dispatch(false)
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('.875')
    expect(registrations).toBe(0)
    cleanup()
  })

  it('does not register a listener for an explicit light theme', () => {
    const darkMedia = fakeMedia(true)
    let registrations = 0
    const addEventListener = darkMedia.addEventListener
    darkMedia.addEventListener = (type, listener) => { registrations += 1; addEventListener(type, listener) }

    applyDocumentPreferences(
      { language: 'en', fontSize: 'medium', theme: 'light' },
      { matchMedia: () => darkMedia },
      document,
    )

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(registrations).toBe(0)
  })

  it('uses legacy media listeners and removes them exactly once', () => {
    const darkMedia = legacyMedia(false)
    const cleanup = applyDocumentPreferences(
      { language: 'en', fontSize: 'medium', theme: 'system' },
      { matchMedia: () => darkMedia },
      document,
    )

    expect(darkMedia.listenerCount).toBe(1)
    darkMedia.dispatch(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    cleanup()
    cleanup()
    expect(darkMedia.listenerCount).toBe(0)
  })
})
