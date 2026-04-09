import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

type UserBarProps = {
  /** sidebar — в колонке меню; inline — в шапке страницы рядом с кнопками */
  layout?: 'sidebar' | 'inline'
  className?: string
}

export function UserBar({ layout = 'sidebar', className }: UserBarProps) {
  const { user, logout } = useAuth()
  if (!user) return null
  if (layout === 'inline') {
    return (
      <div className={cn('flex flex-wrap items-center gap-3', className)}>
        <span className="max-w-[14rem] truncate text-sm text-muted-foreground" title={user.email}>
          <span className="font-medium text-foreground">{user.username}</span>
          <span className="text-muted-foreground"> · {user.role}</span>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
          Выйти
        </Button>
      </div>
    )
  }
  return (
    <div className={cn('mt-auto flex flex-col gap-2 border-t border-border pt-3', className)}>
      <p className="truncate text-xs text-muted-foreground" title={user.email}>
        <span className="font-medium text-foreground">{user.username}</span>
        <span className="block truncate opacity-80">{user.role}</span>
      </p>
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void logout()}>
        Выйти
      </Button>
    </div>
  )
}
