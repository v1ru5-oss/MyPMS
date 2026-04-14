import {
  BarChart3,
  ClipboardList,
  DoorClosed,
  Home,
  Menu,
  NotebookPen,
  PanelLeftClose,
  Shield,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { AppSidebarConciergePanels } from '@/components/AppSidebarConciergePanels'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { UserBar } from '@/components/UserBar'
import { Button, buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import {
  isAdminUser,
  isConciergeUser,
  isHousekeeperUser,
  isSeniorTechnicianUser,
  isTechnicianUser,
} from '@/lib/access'
import { cn } from '@/lib/utils'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    buttonVariants({ variant: isActive ? 'default' : 'outline' }),
    'w-full justify-start gap-2',
  )
}

function navLinkCompactClass({ isActive }: { isActive: boolean }) {
  return cn(buttonVariants({ variant: isActive ? 'default' : 'outline' }), 'h-10 w-10 justify-center p-0')
}

export default function AppLayout() {
  const { user } = useAuth()
  const admin = user ? isAdminUser(user) : false
  const conciergeOps = user ? admin || isConciergeUser(user) : false
  const closedRoomsOps = user ? admin || isConciergeUser(user) || isTechnicianUser(user) || isSeniorTechnicianUser(user) : false
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
  const isDesktopCollapsed = !isMobile && !sidebarOpen
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
          'fixed inset-y-0 left-0 w-56 md:fixed md:inset-y-0 md:left-0 md:h-screen md:shrink-0',
          sidebarOpen
            ? 'translate-x-0 border-border bg-background'
            : isMobile
              ? '-translate-x-full md:translate-x-0'
              : 'translate-x-0 border-border bg-muted/20',
          !isMobile && sidebarOpen ? 'md:w-56 md:border-border md:bg-muted/20' : '',
          !isMobile && !sidebarOpen ? 'md:w-16' : '',
        )}
      >
        <aside
          className={cn(
            'flex min-h-full flex-col gap-2',
            isDesktopCollapsed ? 'w-16 p-2' : 'w-56 p-4',
            !isMobile &&
              'transition-transform duration-300 ease-in-out motion-reduce:transition-none',
            isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0',
          )}
        >
          {isDesktopCollapsed ? null : (
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
          )}

          <div
            className={cn(
              'min-h-0 flex-1 space-y-2 overflow-y-auto',
              isDesktopCollapsed ? 'flex flex-col items-center' : '',
            )}
          >
            {!isDesktopCollapsed ? (
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Разделы
              </p>
            ) : null}
            <NavLink
              to="/"
              end
              className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
              onClick={handleNavClick}
              aria-label="Главная"
              title="Главная"
            >
              <Home className="h-4 w-4 shrink-0" aria-hidden />
              {!isDesktopCollapsed ? 'Главная' : null}
            </NavLink>
            {admin ? (
              <NavLink
                to="/summary"
                className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
                onClick={handleNavClick}
                aria-label="Сводные данные"
                title="Сводные данные"
              >
                <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
                {!isDesktopCollapsed ? 'Сводные данные' : null}
              </NavLink>
            ) : null}
            {conciergeOps ? (
              <NavLink
                to="/notes"
                className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
                onClick={handleNavClick}
                aria-label="Заметки"
                title="Заметки"
              >
                <NotebookPen className="h-4 w-4 shrink-0" aria-hidden />
                {!isDesktopCollapsed ? 'Заметки' : null}
              </NavLink>
            ) : null}
            {conciergeOps ? (
              <NavLink
                to="/guests"
                className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
                onClick={handleNavClick}
                aria-label="Список гостей"
                title="Список гостей"
              >
                <Users className="h-4 w-4 shrink-0" aria-hidden />
                {!isDesktopCollapsed ? 'Список гостей' : null}
              </NavLink>
            ) : null}
            {closedRoomsOps ? (
              <NavLink
                to="/closed-rooms"
                className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
                onClick={handleNavClick}
                aria-label="Закрытые номера"
                title="Закрытые номера"
              >
                <DoorClosed className="h-4 w-4 shrink-0" aria-hidden />
                {!isDesktopCollapsed ? 'Закрытые номера' : null}
              </NavLink>
            ) : null}
            {showRoomCleaningNav ? (
              <NavLink
                to="/room-cleaning"
                className={isDesktopCollapsed ? navLinkCompactClass : navLinkClass}
                onClick={handleNavClick}
                aria-label="Уборка в номерах"
                title="Уборка в номерах"
              >
                <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
                {!isDesktopCollapsed ? 'Уборка в номерах' : null}
              </NavLink>
            ) : null}
            {!isDesktopCollapsed ? (
              <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Действия
              </p>
            ) : (
              <div className="my-1 w-full border-t border-border" />
            )}
            <AppSidebarConciergePanels compact={isDesktopCollapsed} />
          </div>
          <UserBar compact={isDesktopCollapsed} />
          {admin ? (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  isDesktopCollapsed
                    ? navLinkCompactClass({ isActive })
                    : navLinkClass({ isActive }),
                  isDesktopCollapsed ? 'mt-2' : 'mt-1',
                )
              }
              onClick={handleNavClick}
              aria-label="Админ панель"
              title="Админ панель"
            >
              <Shield className="h-4 w-4 shrink-0" aria-hidden />
              {!isDesktopCollapsed ? 'Админ панель' : null}
            </NavLink>
          ) : null}
        </aside>
      </div>

      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-auto transition-[margin] duration-300 ease-in-out motion-reduce:transition-none',
          !isMobile && sidebarOpen ? 'md:ml-56' : '',
          !isMobile && !sidebarOpen ? 'md:ml-16' : '',
        )}
      >
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
