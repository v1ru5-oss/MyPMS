import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react'

import { ThemeContext } from '@/contexts/theme-context'
import {
  applyThemeClass,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme-storage'

function subscribeToSystemTheme(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function getSystemSnapshot() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useSyncExternalStore(subscribeToSystemTheme, getSystemSnapshot, () => 'light')

  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme() ?? 'system')

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : theme

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    applyThemeClass(next)
  }, [])

  useEffect(() => {
    applyThemeClass(theme)
  }, [theme, systemScheme])

  const value = useMemo(() => ({ theme, setTheme, resolved }), [theme, setTheme, resolved])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
