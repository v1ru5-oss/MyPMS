import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { safePathAfterLogin } from '@/lib/access'
import { fetchProfileOrFallback } from '@/lib/pms-db'
import { getSupabase } from '@/lib/supabase'

export default function LoginPage() {
  const { login, user, isReady, requestPasswordReset } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  const [loginName, setLoginName] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')

  const [recoveryMode, setRecoveryMode] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [recoveryErr, setRecoveryErr] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)

  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg] = useState('')
  const [forgotErr, setForgotErr] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=recovery')) {
      setRecoveryMode(true)
    }
  }, [])

  useEffect(() => {
    const sb = getSupabase()
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!isReady || !user || recoveryMode) return
    navigate(safePathAfterLogin(user, from), { replace: true })
  }, [isReady, user, recoveryMode, from, navigate])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoginError('')
    const res = await login(loginName, loginPass)
    if (!res.ok) setLoginError(res.error ?? 'Ошибка входа')
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault()
    setRecoveryErr('')
    if (newPass.length < 6) {
      setRecoveryErr('Пароль не короче 6 символов.')
      return
    }
    if (newPass !== newPass2) {
      setRecoveryErr('Пароли не совпадают.')
      return
    }
    setRecoveryBusy(true)
    const sb = getSupabase()
    const { error } = await sb.auth.updateUser({ password: newPass })
    setRecoveryBusy(false)
    if (error) {
      setRecoveryErr(error.message || 'Не удалось сохранить пароль.')
      return
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const {
      data: { session },
    } = await sb.auth.getSession()
    if (session?.user) {
      const p = await fetchProfileOrFallback(session.user)
      navigate(safePathAfterLogin(p, from), { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault()
    setForgotMsg('')
    setForgotErr('')
    setForgotBusy(true)
    const res = await requestPasswordReset(forgotEmail)
    setForgotBusy(false)
    if (res.ok) {
      setForgotMsg('Если такой email есть в системе, на него отправлена ссылка для сброса пароля.')
    } else {
      setForgotErr(res.error ?? 'Ошибка')
    }
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Загрузка…</p>
      </div>
    )
  }

  if (user && !recoveryMode) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Переход…</p>
      </div>
    )
  }

  if (recoveryMode && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <p className="text-center text-sm text-muted-foreground">
          Вход по ссылке из письма… Если окно не меняется, откройте ссылку снова или проверьте Redirect URLs в Supabase.
        </p>
      </div>
    )
  }

  if (recoveryMode && user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Новый пароль</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Задайте пароль для входа в MyPMS. После сохранения вы останетесь в системе.
          </p>
          <form className="mt-6 grid gap-4" onSubmit={handleRecoverySubmit}>
            <div className="grid gap-2">
              <Label htmlFor="recoveryPass">Новый пароль</Label>
              <Input
                id="recoveryPass"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="recoveryPass2">Повтор пароля</Label>
              <Input
                id="recoveryPass2"
                type="password"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {recoveryErr ? <p className="text-sm text-red-600">{recoveryErr}</p> : null}
            <Button type="submit" disabled={recoveryBusy}>
              {recoveryBusy ? 'Сохранение…' : 'Сохранить и войти'}
            </Button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">MyPMS</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Вход для сотрудников. Можно ввести email целиком или только логин (без @) — тогда подставится домен из{' '}
          <code className="rounded bg-muted px-1">VITE_AUTH_EMAIL_DOMAIN</code> в{' '}
          <code className="rounded bg-muted px-1">.env.local</code>.
        </p>
        <form className="mt-6 grid gap-4" onSubmit={handleLogin}>
          <div className="grid gap-2">
            <Label htmlFor="loginUser">Логин или email</Label>
            <Input
              id="loginUser"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="loginPass">Пароль</Label>
            <Input
              id="loginPass"
              type="password"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {loginError ? <p className="text-sm text-red-600">{loginError}</p> : null}
          <Button type="submit">Войти</Button>
        </form>

        <div className="mt-6 border-t border-border pt-6">
          <button
            type="button"
            className="text-sm text-primary underline-offset-2 hover:underline"
            onClick={() => {
              setShowForgot((v) => !v)
              setForgotMsg('')
              setForgotErr('')
            }}
          >
            {showForgot ? 'Скрыть' : 'Забыли пароль?'}
          </button>
          {showForgot ? (
            <form className="mt-4 grid gap-3" onSubmit={handleForgotSubmit}>
              <p className="text-xs text-muted-foreground">
                На email придёт ссылка от Supabase Auth. Адрес страницы после перехода:{' '}
                <code className="rounded bg-muted px-1">/login</code> — добавьте его в Redirect URLs в консоли
                Supabase.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="forgotEmail">Email</Label>
                <Input
                  id="forgotEmail"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="email@… или логин"
                  autoComplete="email"
                />
              </div>
              {forgotErr ? <p className="text-sm text-red-600">{forgotErr}</p> : null}
              {forgotMsg ? <p className="text-sm text-green-700 dark:text-green-400">{forgotMsg}</p> : null}
              <Button type="submit" variant="outline" disabled={forgotBusy}>
                {forgotBusy ? 'Отправка…' : 'Отправить ссылку'}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  )
}
