import { useLocation } from 'react-router-dom'

import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { cn } from '@/lib/utils'

/** Фиксированный переключатель темы на экране входа (основной layout без сайдбара). */
export function LoginRouteThemeControl() {
  const { pathname } = useLocation()
  if (pathname !== '/login') return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-end p-3 sm:p-4',
      )}
    >
      <div className="pointer-events-auto">
        <ThemeSwitcher />
      </div>
    </div>
  )
}
