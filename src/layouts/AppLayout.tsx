import { Menu, PanelLeftClose } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { AppSidebarConciergePanels } from '@/components/AppSidebarConciergePanels'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { UserBar } from '@/components/UserBar'
import { Button, buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser, isConciergeUser, isHousekeeperUser } from '@/lib/access'
import { cn } from '@/lib/utils'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    buttonVariants({ variant: isActive ? 'default' : 'outline' }),
    'w-full justify-start',
  )
}

export default function AppLayout() {
  const { user } = useAuth()
  const admin = user ? isAdminUser(user) : false
  const conciergeOps = user ? admin || isConciergeUser(user) : false
  const showRoomCleaningNav = user ? admin || isHousekeeperUser(user) : false

  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <main className="relative flex min-h-0 min-h-full w-full flex-1">
      <div className="pointer-events-none fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-[45]">
        <div className="pointer-events-auto">
          <ThemeSwitcher />
        </div>
      </div>

      <div
        className={cn(
          'box-border shrink-0 overflow-hidden border-r transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
          sidebarOpen ? 'w-56 border-border bg-muted/20' : 'w-0 border-transparent bg-transparent',
        )}
      >
        <aside
          className={cn(
            'flex min-h-full w-56 flex-col gap-2 p-4 transition-transform duration-300 ease-in-out motion-reduce:transition-none',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-start justify-between gap-1">
            <h1 className="min-w-0 text-xl font-semibold leading-tight tracking-tight">MyPMS</h1>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-8 shrink-0 p-0"
              onClick={() => setSidebarOpen(false)}
              aria-label="Скрыть меню"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Разделы
          </p>
          <NavLink to="/" end className={navLinkClass}>
            Главная
          </NavLink>
          {admin ? (
            <NavLink to="/summary" className={navLinkClass}>
              Сводные данные
            </NavLink>
          ) : null}
          {conciergeOps ? (
            <NavLink to="/guests" className={navLinkClass}>
              Список гостей
            </NavLink>
          ) : null}
          {showRoomCleaningNav ? (
            <NavLink to="/room-cleaning" className={navLinkClass}>
              Уборка в номерах
            </NavLink>
          ) : null}
          {admin ? (
            <NavLink to="/admin" className={navLinkClass}>
              Админ панель
            </NavLink>
          ) : null}

          <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Действия
          </p>
          <AppSidebarConciergePanels />
          <UserBar />
        </aside>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {!sidebarOpen ? (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4 shrink-0" aria-hidden />
              Открыть меню
            </Button>
          </div>
        ) : null}
        <Outlet />
      </div>
    </main>
  )
}
