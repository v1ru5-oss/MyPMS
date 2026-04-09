import { format, parseISO } from 'date-fns'
import { FileUser, PlusSquare } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser, isConciergeUser } from '@/lib/access'
import { fetchGuests, fetchRooms } from '@/lib/pms-db'
import type { Guest, Room } from '@/types/models'

type AppSidebarConciergePanelsProps = {
  compact?: boolean
}

export function AppSidebarConciergePanels({ compact = false }: AppSidebarConciergePanelsProps) {
  const { user } = useAuth()
  const admin = user ? isAdminUser(user) : false
  const conciergeOps = user ? admin || isConciergeUser(user) : false
  const navigate = useNavigate()

  const [rooms, setRooms] = useState<Room[]>([])
  const [guests, setGuests] = useState<Guest[]>([])

  const [isGuestCardModalOpen, setIsGuestCardModalOpen] = useState(false)
  const [guestCardSearchFirstName, setGuestCardSearchFirstName] = useState('')
  const [guestCardSearchLastName, setGuestCardSearchLastName] = useState('')

  useEffect(() => {
    if (!conciergeOps) return
    let cancelled = false
    void (async () => {
      try {
        const [r, g] = await Promise.all([fetchRooms(), fetchGuests()])
        if (!cancelled) {
          setRooms(r)
          setGuests(g)
        }
      } catch {
        /* списки остаются пустыми / прежними */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [conciergeOps])

  const guestsMatchingCardSearch = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase()
    const qFirst = norm(guestCardSearchFirstName)
    const qLast = norm(guestCardSearchLastName)
    return guests.filter((guest) => {
      const okFirst = !qFirst || guest.firstName.toLowerCase().includes(qFirst)
      const okLast = !qLast || guest.lastName.toLowerCase().includes(qLast)
      return okFirst && okLast
    })
  }, [guests, guestCardSearchFirstName, guestCardSearchLastName])

  if (!conciergeOps) return null

  return (
    <>
      <Dialog
        open={isGuestCardModalOpen}
        onOpenChange={(open) => {
          setIsGuestCardModalOpen(open)
          if (open) {
            void fetchGuests()
              .then(setGuests)
              .catch(() => {
                /* оставляем текущий список */
              })
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            className={compact ? 'h-10 w-10 p-0 bg-red-600 text-white hover:bg-red-700' : 'w-full gap-2 bg-red-600 text-white hover:bg-red-700'}
            aria-label="Карточка гостя"
            title="Карточка гостя"
          >
            <FileUser className="h-4 w-4 shrink-0" aria-hidden />
            {!compact ? 'Карточка гостя' : null}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Карточка гостя</DialogTitle>
            <DialogDescription>
              Поиск по имени и фамилии; список обновляется при вводе. Нажмите на гостя, чтобы открыть страницу
              карточки.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-2">
                <Label htmlFor="appSidebarGuestCardSearchFirstName">Имя</Label>
                <Input
                  id="appSidebarGuestCardSearchFirstName"
                  value={guestCardSearchFirstName}
                  onChange={(e) => setGuestCardSearchFirstName(e.target.value)}
                  placeholder="Начните вводить имя"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="appSidebarGuestCardSearchLastName">Фамилия</Label>
                <Input
                  id="appSidebarGuestCardSearchLastName"
                  value={guestCardSearchLastName}
                  onChange={(e) => setGuestCardSearchLastName(e.target.value)}
                  placeholder="Начните вводить фамилию"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Найдено: {guestsMatchingCardSearch.length}
                {guests.length === 0 ? ' (в таблице Guest пока нет записей)' : null}
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                {guestsMatchingCardSearch.length === 0 ? (
                  <li className="text-sm text-muted-foreground">
                    {guests.length === 0
                      ? 'Добавьте бронь на главной (кнопка «Добавить бронь» или меню слева).'
                      : 'Нет совпадений — измените условия поиска.'}
                  </li>
                ) : (
                  guestsMatchingCardSearch.map((guest) => {
                    const room = rooms.find((r) => r.id === guest.roomId)
                    return (
                      <li key={guest.id}>
                        <button
                          type="button"
                          className="w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                          onClick={() => {
                            setIsGuestCardModalOpen(false)
                            navigate(`/guest/${guest.id}`)
                          }}
                        >
                          <div>
                            <span className="font-medium">
                              {guest.lastName} {guest.firstName}
                            </span>
                            <span className="text-muted-foreground">
                              {' '}
                              · номер: {room?.name ?? guest.roomId}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Заезд: {format(parseISO(guest.startDate), 'dd.MM.yyyy')} · Выезд:{' '}
                            {format(parseISO(guest.endDate), 'dd.MM.yyyy')}
                          </p>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Button
        type="button"
        className={compact ? 'h-10 w-10 p-0' : 'w-full gap-2'}
        variant="outline"
        onClick={() => navigate({ pathname: '/', search: '?newBooking=1' })}
        aria-label="Добавить бронь"
        title="Добавить бронь"
      >
        <PlusSquare className="h-4 w-4 shrink-0" aria-hidden />
        {!compact ? 'Добавить бронь' : null}
      </Button>
    </>
  )
}
