import type { AppPreferences } from '../stores/via'
import { resolveSystemLanguage } from '../i18n'

type ResolvedTheme = 'light' | 'dark'

interface DarkMediaQueryList {
  matches: boolean
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void
  addListener?: (listener: (event: { matches: boolean }) => void) => void
  removeListener?: (listener: (event: { matches: boolean }) => void) => void
}

export interface PreferenceWindow {
  navigator?: { language?: string }
  matchMedia?: (query: string) => DarkMediaQueryList
}

const themes: Record<ResolvedTheme, Record<string, string>> = {
  dark: { '--canvas': '#0d1117', '--surface': '#161b22', '--surface-raised': '#21262d', '--line': '#30363d', '--text': '#e6edf3', '--muted': '#8b949e', '--blue': '#388bfd', '--green': '#3fb950', '--red': '#f85149', '--yellow': '#d29922' },
  light: { '--canvas': '#f6f8fa', '--surface': '#ffffff', '--surface-raised': '#eaeef2', '--line': '#d0d7de', '--text': '#1f2328', '--muted': '#57606a', '--blue': '#0969da', '--green': '#1a7f37', '--red': '#cf222e', '--yellow': '#9a6700' },
}

const fontScales: Record<AppPreferences['fontSize'], string> = { small: '.875', medium: '1', large: '1.125' }

function applyTheme(root: HTMLElement, theme: ResolvedTheme) {
  root.dataset.theme = theme
  for (const [name, value] of Object.entries(themes[theme])) root.style.setProperty(name, value)
  root.style.color = 'var(--text)'
  root.style.backgroundColor = 'var(--canvas)'
}

export function applyDocumentPreferences(
  preferences: AppPreferences,
  window: PreferenceWindow,
  document: Pick<Document, 'documentElement'>,
): () => void {
  const root = document.documentElement
  root.lang = resolveSystemLanguage(preferences.language, window.navigator?.language)
  root.dataset.fontSize = preferences.fontSize
  root.style.setProperty('--app-font-scale', fontScales[preferences.fontSize])
  root.style.fontSize = 'calc(16px * var(--app-font-scale))'

  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  const applyCurrentTheme = (systemDark = media?.matches ?? false) => {
    applyTheme(root, preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme)
  }
  applyCurrentTheme()

  if (preferences.theme !== 'system' || !media) return () => undefined

  const onChange = (event: { matches: boolean }) => applyCurrentTheme(event.matches)
  if (media.addEventListener) {
    media.addEventListener('change', onChange)
    let cleaned = false
    return () => {
      if (cleaned) return
      cleaned = true
      media.removeEventListener?.('change', onChange)
    }
  }

  media.addListener?.(onChange)
  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    media.removeListener?.(onChange)
  }
}
