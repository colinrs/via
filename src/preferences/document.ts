import type { AppPreferences } from '../stores/via'
import { resolveSystemLanguage } from '../i18n'

export interface PreferenceWindow {
  navigator?: { language?: string }
}

const palette: Record<string, string> = {
  '--canvas': '#c6c6c6',
  '--surface': '#c6c6c6',
  '--surface-raised': '#c6c6c6',
  '--content': '#ffffff',
  '--line': '#000000',
  '--text': '#000000',
  '--muted': '#555555',
  '--blue': '#000000',
  '--green': '#1a7f37',
  '--red': '#b3261e',
  '--yellow': '#996600',
}

const fontScales: Record<AppPreferences['fontSize'], string> = {
  small: '.875',
  medium: '1',
  large: '1.125',
}

function applyTheme(root: HTMLElement) {
  root.dataset.theme = 'mac'
  for (const [name, value] of Object.entries(palette))
    root.style.setProperty(name, value)
  root.style.color = 'var(--text)'
  root.style.backgroundColor = 'var(--canvas)'
}

export function applyDocumentPreferences(
  preferences: AppPreferences,
  window: PreferenceWindow,
  document: Pick<Document, 'documentElement'>
): () => void {
  const root = document.documentElement
  root.lang = resolveSystemLanguage(
    preferences.language,
    window.navigator?.language
  )
  root.dataset.fontSize = preferences.fontSize
  root.style.setProperty('--app-font-scale', fontScales[preferences.fontSize])
  root.style.removeProperty('font-size')
  root.style.setProperty('zoom', fontScales[preferences.fontSize])
  applyTheme(root)
  return () => undefined
}
