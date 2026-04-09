import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { isAdminUser } from '@/lib/access'
import { loginToEmail } from '@/lib/auth-email'
import { fetchProfileOrFallback } from '@/lib/pms-db'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { type PublicUser, type UserRole } from '@/types/models'

type AuthContextValue = {
  user: PublicUser | null
  isReady: boolean
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  /** Письмо со ссылкой сброса пароля (Supabase Auth). */
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>
  addUser: (params: {
    username: string
    role: UserRole
    canManageUsers: boolean
    fullAccess: boolean
  }) => Promise<{ ok: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsReady(true)
      return
    }

    let cancelled = false
    const sb = getSupabase()

    void sb.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return
      if (session?.user) {
        const p = await fetchProfileOrFallback(session.user)
        if (!cancelled) setUser(p)
      } else if (!cancelled) {
        setUser(null)
      }
      if (!cancelled) setIsReady(true)
    })

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        if (cancelled) return
        if (session?.user) {
          const p = await fetchProfileOrFallback(session.user)
          if (!cancelled) setUser(p)
        } else if (!cancelled) {
          setUser(null)
        }
      })()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: 'Нет конфигурации Supabase.' }
    }
    const email = loginToEmail(username)
    const sb = getSupabase()
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) {
      return { ok: false, error: 'Неверный логин или пароль.' }
    }
    const {
      data: { session },
    } = await sb.auth.getSession()
    if (session?.user) {
      const p = await fetchProfileOrFallback(session.user)
      setUser(p)
    }
    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setUser(null)
      return
    }
    await getSupabase().auth.signOut()
    setUser(null)
  }, [])

  const requestPasswordReset = useCallback(async (emailRaw: string) => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: 'Нет конфигурации Supabase.' }
    }
    const raw = emailRaw.trim()
    if (!raw) {
      return { ok: false, error: 'Укажите email.' }
    }
    const email = loginToEmail(raw)
    const redirectTo = `${window.location.origin}/login`
    const sb = getSupabase()
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) {
      return { ok: false, error: error.message || 'Не удалось отправить письмо.' }
    }
    return { ok: true }
  }, [])

  const addUser = useCallback(
    async (params: {
      username: string
      role: UserRole
      canManageUsers: boolean
      fullAccess: boolean
    }) => {
      if (!isSupabaseConfigured) {
        return { ok: false, error: 'Нет конфигурации Supabase.' }
      }
      const current = user
      if (!current || !isAdminUser(current)) {
        return { ok: false, error: 'Только администратор может добавлять пользователей.' }
      }
      const raw = params.username.trim()
      if (!raw) {
        return { ok: false, error: 'Укажите email или логин.' }
      }
      const email = loginToEmail(raw)
      const username = raw.includes('@')
        ? (raw.split('@')[0] ?? '').trim() || email.split('@')[0]!
        : raw

      const sb = getSupabase()
      const {
        data: { session },
      } = await sb.auth.getSession()
      if (!session?.access_token) {
        return { ok: false, error: 'Нет активной сессии. Войдите снова.' }
      }

      const base = import.meta.env.VITE_SUPABASE_URL!.replace(/\/$/, '')
      const res = await fetch(`${base}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          username,
          role: params.role,
          can_manage_users: params.canManageUsers,
          full_access: params.fullAccess,
        }),
      })

      let payload: { error?: string; ok?: boolean } = {}
      try {
        payload = (await res.json()) as typeof payload
      } catch {
        return {
          ok: false,
          error:
            'Не удалось создать пользователя. Разверните Edge Function create-user (см. supabase/functions).',
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          error:
            payload.error ??
            'Не удалось создать пользователя. Проверьте функцию create-user и логи.',
        }
      }

      return { ok: true }
    },
    [user],
  )

  const value = useMemo(
    () => ({
      user,
      isReady,
      login,
      logout,
      requestPasswordReset,
      addUser,
    }),
    [user, isReady, login, logout, requestPasswordReset, addUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
