export const THEME_STORAGE_KEY = 'mypms-theme'

export type ThemePreference = 'light' | 'dark' | 'system'

export function readStoredTheme(): ThemePreference | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* private mode */
  }
  return null
}

export function isDarkResolved(preference: ThemePreference): boolean {
  if (preference === 'dark') return true
  if (preference === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyThemeClass(preference: ThemePreference): void {
  document.documentElement.classList.toggle('dark', isDarkResolved(preference))
}
