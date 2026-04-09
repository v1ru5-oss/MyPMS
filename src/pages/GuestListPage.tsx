import { format, isValid, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { GuestDetailPanel } from '@/components/GuestDetailPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  guestHasCheckedOut,
  isGuestCheckInConfirmed,
} from '@/lib/guest-checkin'
import { fetchBookings, fetchGuests, fetchRooms } from '@/lib/pms-db'
import { type Booking, type Guest, type Room } from '@/types/models'

type GuestStatusFilter = 'all' | 'checked_in' | 'checked_out'

/** Подтверждённый заезд (логика согласована с шахматкой и бронями). */
function guestIsCheckedInOnly(g: Guest, bookings: Booking[]): boolean {
  return isGuestCheckInConfirmed(g, bookings)
}

function formatActualCheckout(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  try {
    const d = parseISO(iso)
    if (!isValid(d)) return '—'
    return format(d, 'dd.MM.yyyy, HH:mm', { locale: ru })
  } catch {
    return '—'
  }
}

/** Дата заезда из карточки + время при нажатии «Подтвердить заезд». */
function formatCheckInColumn(startDate: string, checkedInAt: string | null | undefined): string {
  const d0 = parseISO(startDate)
  if (!isValid(d0)) return startDate
  let s = format(d0, 'dd.MM.yyyy', { locale: ru })
  if (checkedInAt?.trim()) {
    const t = parseISO(checkedInAt)
    if (isValid(t)) {
      s += `, ${format(t, 'HH:mm', { locale: ru })}`
    }
  }
  return s
}

export default function GuestListPage() {
  const location = useLocation()
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loadError, setLoadError] = useState('')
  const [qFirstName, setQFirstName] = useState('')
  const [qLastName, setQLastName] = useState('')
  const [qStartDate, setQStartDate] = useState('')
  const [qEndDate, setQEndDate] = useState('')
  const [qStatus, setQStatus] = useState<GuestStatusFilter>('all')
  const [dialogGuestId, setDialogGuestId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void (async () => {
      try {
        const [r, b, g] = await Promise.all([fetchRooms(), fetchBookings(), fetchGuests()])
        if (!cancelled) {
          setRooms(r)
          setBookings(b)
          setGuests(g)
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить данные.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.key])

  const filteredGuests = useMemo(() => {
    const nf = qFirstName.trim().toLowerCase()
    const nl = qLastName.trim().toLowerCase()
    const list = guests.filter((g) => {
      if (nf && !g.firstName.toLowerCase().includes(nf)) return false
      if (nl && !g.lastName.toLowerCase().includes(nl)) return false
      if (qStartDate && g.startDate !== qStartDate) return false
      if (qEndDate && g.endDate !== qEndDate) return false
      if (qStatus === 'checked_in' && !guestIsCheckedInOnly(g, bookings)) return false
      if (qStatus === 'checked_out' && !guestHasCheckedOut(g)) return false
      return true
    })

    /** Для «Все»: заехали → без статуса → выехали; внутри группы — по ФИО. */
    function statusSortKey(g: Guest): number {
      if (guestHasCheckedOut(g)) return 2
      if (guestIsCheckedInOnly(g, bookings)) return 0
      return 1
    }

    return list.sort((a, b) => {
      if (qStatus === 'all') {
        const sk = statusSortKey(a) - statusSortKey(b)
        if (sk !== 0) return sk
      }
      const c = a.lastName.localeCompare(b.lastName, 'ru')
      if (c !== 0) return c
      const c1 = a.firstName.localeCompare(b.firstName, 'ru')
      if (c1 !== 0) return c1
      return (a.middleName ?? '').localeCompare(b.middleName ?? '', 'ru')
    })
  }, [guests, bookings, qFirstName, qLastName, qStartDate, qEndDate, qStatus])

  return (
    <main className="flex min-h-screen w-full flex-col gap-6 p-6">
      <Dialog
        open={dialogGuestId !== null}
        onOpenChange={(open) => {
          if (!open) setDialogGuestId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sr-only">Карточка гостя</DialogTitle>
            <DialogDescription className="sr-only">
              Подробные данные гостя и проживания
            </DialogDescription>
          </DialogHeader>
          {dialogGuestId ? (
            <GuestDetailPanel key={dialogGuestId} guestId={dialogGuestId} layout="embedded" />
          ) : null}
        </DialogContent>
      </Dialog>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">Список гостей</h1>
          <p className="text-sm text-muted-foreground">
            Таблица Guest и брони (как на шахматке). Статус «Заехал» — подтверждённый заезд (кнопка «Подтвердить
            заезд» для брони с карточкой гостя); «Не подтвержден» — заезд ещё не подтверждён. «Выехал» — отмечен
            выезд на главной.
          </p>
          {loadError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {loadError}
            </p>
          ) : null}
        </div>
      </header>

      <section className="rounded-lg border border-border bg-muted/10 p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Поиск
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="grid gap-1.5">
            <Label htmlFor="gl-first" className="text-xs">
              Имя
            </Label>
            <Input
              id="gl-first"
              value={qFirstName}
              onChange={(e) => setQFirstName(e.target.value)}
              placeholder="Подстрока"
              className="h-8 text-xs"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-last" className="text-xs">
              Фамилия
            </Label>
            <Input
              id="gl-last"
              value={qLastName}
              onChange={(e) => setQLastName(e.target.value)}
              placeholder="Подстрока"
              className="h-8 text-xs"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-start" className="text-xs">
              Дата заезда
            </Label>
            <Input
              id="gl-start"
              type="date"
              value={qStartDate}
              onChange={(e) => setQStartDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-end" className="text-xs">
              Дата выезда
            </Label>
            <Input
              id="gl-end"
              type="date"
              value={qEndDate}
              onChange={(e) => setQEndDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="gl-status" className="text-xs">
              Статус
            </Label>
            <select
              id="gl-status"
              value={qStatus}
              onChange={(e) => setQStatus(e.target.value as GuestStatusFilter)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">Все</option>
              <option value="checked_in">Только заехали</option>
              <option value="checked_out">Только выехали</option>
            </select>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Найдено: {filteredGuests.length} из {guests.length}
          {qStatus === 'all'
            ? ' · порядок: заехали, ожидают заезда, выехали'
            : null}
        </p>
      </section>

      <section className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-2 py-1.5 font-medium">Фамилия</th>
              <th className="px-2 py-1.5 font-medium">Имя</th>
              <th className="px-2 py-1.5 font-medium">Отчество</th>
              <th className="px-2 py-1.5 font-medium">Номер</th>
              <th className="px-2 py-1.5 font-medium">Заезд</th>
              <th className="px-2 py-1.5 font-medium">Выезд</th>
              <th className="min-w-[8.5rem] px-2 py-1.5 font-medium leading-tight">
                Фактическая дата выезда
              </th>
              <th className="px-2 py-1.5 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filteredGuests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                  {loadError ? 'Нет данных.' : 'Нет записей по текущим условиям.'}
                </td>
              </tr>
            ) : (
              filteredGuests.map((guest) => {
                const room = rooms.find((r) => r.id === guest.roomId)
                const guestLabel = [guest.lastName, guest.firstName, guest.middleName?.trim()]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <tr
                    key={guest.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => setDialogGuestId(guest.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setDialogGuestId(guest.id)
                      }
                    }}
                    aria-label={`Карточка гостя: ${guestLabel}`}
                  >
                    <td className="px-2 py-1.5 font-medium">{guest.lastName}</td>
                    <td className="px-2 py-1.5">{guest.firstName}</td>
                    <td className="max-w-[7rem] truncate px-2 py-1.5 text-muted-foreground">
                      {guest.middleName?.trim() ?? '—'}
                    </td>
                    <td className="max-w-[8rem] truncate px-2 py-1.5 text-muted-foreground">
                      {room?.name ?? guest.roomId}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                      {formatCheckInColumn(guest.startDate, guest.checkedInAt)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                      {format(parseISO(guest.endDate), 'dd.MM.yyyy', { locale: ru })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                      {formatActualCheckout(guest.checkedOutAt)}
                    </td>
                    <td className="px-2 py-1.5">
                      {(() => {
                        if (guestHasCheckedOut(guest)) {
                          return (
                            <span className="rounded-md border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900 dark:border-red-800 dark:bg-red-950/70 dark:text-red-100">
                              Выехал
                            </span>
                          )
                        }
                        if (isGuestCheckInConfirmed(guest, bookings)) {
                          return (
                            <span className="rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">
                              Заехал
                            </span>
                          )
                        }
                        return (
                          <span className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
                            Не подтвержден
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
