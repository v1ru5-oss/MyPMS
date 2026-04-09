import { type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessPath } from '@/lib/access'
import { cn } from '@/lib/utils'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isReady } = useAuth()
  const loc = useLocation()

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Загрузка…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: loc }} replace />
  }

  if (!canAccessPath(loc.pathname, user)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">Нет доступа</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          У вашей роли нет прав на этот раздел. Обратитесь к администратору.
        </p>
        <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          На главную
        </Link>
        <Link
          to="/login"
          className={cn(buttonVariants({ variant: 'outline' }), 'border-transparent text-muted-foreground shadow-none')}
        >
          Сменить пользователя
        </Link>
      </main>
    )
  }

  return <>{children}</>
}
