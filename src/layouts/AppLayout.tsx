import { Menu, PanelLeftClose } from 'lucide-react'
import { useEffect, useState } from 'react'
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

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = (mobile: boolean) => {
      setIsMobile(mobile)
      setSidebarOpen(!mobile)
    }
    sync(media.matches)
    const onChange = (event: MediaQueryListEvent) => {
      sync(event.matches)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isMobile, sidebarOpen])

  const closeSidebar = () => setSidebarOpen(false)
  const openSidebar = () => setSidebarOpen(true)
  const handleNavClick = () => {
    if (isMobile) closeSidebar()
  }

  return (
    <main className="relative flex min-h-0 min-h-full w-full flex-1 overflow-hidden">
      <div className="pointer-events-none fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.75rem,env(safe-area-inset-top,0px))] z-[45]">
        <div className="pointer-events-auto">
          <ThemeSwitcher />
        </div>
      </div>

      {isMobile && sidebarOpen ? (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] md:hidden"
          onClick={closeSidebar}
        />
      ) : null}

      <div
        className={cn(
          'box-border z-50 overflow-hidden border-r transition-[width,transform] duration-300 ease-in-out motion-reduce:transition-none',
          'fixed inset-y-0 left-0 w-56 md:relative md:inset-auto md:shrink-0',
          sidebarOpen ? 'translate-x-0 border-border bg-background' : '-translate-x-full md:translate-x-0',
          !isMobile && sidebarOpen ? 'md:w-56 md:border-border md:bg-muted/20' : '',
          !isMobile && !sidebarOpen ? 'md:w-0 md:border-transparent md:bg-transparent' : '',
        )}
      >
        <aside
          className={cn(
            'flex min-h-full w-56 flex-col gap-2 p-4',
            !isMobile &&
              'transition-transform duration-300 ease-in-out motion-reduce:transition-none',
            !isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0',
          )}
        >
          <div className="flex items-start justify-between gap-1">
            <h1 className="min-w-0 text-xl font-semibold leading-tight tracking-tight">MyPMS</h1>
            <Button
              type="button"
              variant="outline"
              className="h-8 w-8 shrink-0 p-0"
              onClick={closeSidebar}
              aria-label="Скрыть меню"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Разделы
          </p>
          <NavLink to="/" end className={navLinkClass} onClick={handleNavClick}>
            Главная
          </NavLink>
          {admin ? (
            <NavLink to="/summary" className={navLinkClass} onClick={handleNavClick}>
              Сводные данные
            </NavLink>
          ) : null}
          {conciergeOps ? (
            <NavLink to="/guests" className={navLinkClass} onClick={handleNavClick}>
              Список гостей
            </NavLink>
          ) : null}
          {showRoomCleaningNav ? (
            <NavLink to="/room-cleaning" className={navLinkClass} onClick={handleNavClick}>
              Уборка в номерах
            </NavLink>
          ) : null}
          {admin ? (
            <NavLink to="/admin" className={navLinkClass} onClick={handleNavClick}>
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
        {!sidebarOpen || isMobile ? (
          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={openSidebar}
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
