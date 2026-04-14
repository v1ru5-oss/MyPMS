import { format, isValid, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { GuestDetailPanel } from '@/components/GuestDetailPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser } from '@/lib/access'
import {
  guestHasCheckedOut,
  isGuestCheckInConfirmed,
} from '@/lib/guest-checkin'
import {
  deleteGuestById,
  fetchBookingSubGuests,
  fetchBookings,
  fetchGuests,
  fetchRooms,
} from '@/lib/pms-db'
import { type Booking, type BookingSubGuest, type Guest, type Room } from '@/types/models'

type GuestStatusFilter = 'all' | 'checked_in' | 'checked_out'
type GuestVisitRow = {
  guest: Guest
  roomName: string
  subGuests: BookingSubGuest[]
  status: 'checked_in' | 'checked_out' | 'pending'
}

type GuestProfileGroup = {
  key: string
  profileId: string | null
  lastName: string
  firstName: string
  middleName: string
  visits: GuestVisitRow[]
}

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
  const { user } = useAuth()
  const isAdmin = user ? isAdminUser(user) : false
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [bookingSubGuests, setBookingSubGuests] = useState<BookingSubGuest[]>([])
  const [loadError, setLoadError] = useState('')
  const [deletingGuestId, setDeletingGuestId] = useState<string | null>(null)
  const [qFirstName, setQFirstName] = useState('')
  const [qLastName, setQLastName] = useState('')
  const [qSubGuestName, setQSubGuestName] = useState('')
  const [qStartDate, setQStartDate] = useState('')
  const [qEndDate, setQEndDate] = useState('')
  const [qStatus, setQStatus] = useState<GuestStatusFilter>('all')
  const [dialogGuestId, setDialogGuestId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoadError('')
    try {
      const [r, b, g, sub] = await Promise.all([
        fetchRooms(),
        fetchBookings(),
        fetchGuests(),
        fetchBookingSubGuests(),
      ])
      setRooms(r)
      setBookings(b)
      setGuests(g)
      setBookingSubGuests(sub)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить данные.')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [location.key, loadData])

  const handleDeleteVisit = useCallback(
    async (guestId: string, guestLabel: string) => {
      if (
        !window.confirm(
          `Удалить карточку гостя «${guestLabel}» и все связанные с ней брони? Действие необратимо.`,
        )
      ) {
        return
      }
      setDeletingGuestId(guestId)
      setLoadError('')
      try {
        await deleteGuestById(guestId)
        await loadData()
        setDialogGuestId((current) => (current === guestId ? null : current))
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Не удалось удалить запись.')
      } finally {
        setDeletingGuestId(null)
      }
    },
    [loadData],
  )

  const bookingsByGuestId = useMemo(() => {
    const map = new Map<string, Booking>()
    bookings.forEach((booking) => {
      const guestId = booking.guestId?.trim()
      if (!guestId) return
      const existing = map.get(guestId)
      if (!existing || booking.startDate > existing.startDate) {
        map.set(guestId, booking)
      }
    })
    return map
  }, [bookings])

  const bookingSubGuestsByBookingId = useMemo(() => {
    const map = new Map<string, BookingSubGuest[]>()
    bookingSubGuests.forEach((item) => {
      const list = map.get(item.bookingId) ?? []
      list.push(item)
      map.set(item.bookingId, list)
    })
    map.forEach((list, key) => {
      map.set(
        key,
        [...list].sort((a, b) => a.position - b.position),
      )
    })
    return map
  }, [bookingSubGuests])

  const profileGroups = useMemo(() => {
    const roomNameById = new Map(rooms.map((room) => [room.id, room.name] as const))
    const groups = new Map<string, GuestProfileGroup>()
    guests.forEach((g) => {
      const profileId = g.profileId?.trim() || null
      const key = profileId ?? `guest:${g.id}`
      const booking = bookingsByGuestId.get(g.id)
      const subGuests =
        booking != null
          ? (bookingSubGuestsByBookingId.get(booking.id) ?? []).filter((item) => item.position > 1)
          : []
      const status: GuestVisitRow['status'] = guestHasCheckedOut(g)
        ? 'checked_out'
        : guestIsCheckedInOnly(g, bookings)
          ? 'checked_in'
          : 'pending'
      const visit: GuestVisitRow = {
        guest: g,
        roomName: roomNameById.get(g.roomId) ?? g.roomId,
        subGuests,
        status,
      }
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, {
          key,
          profileId,
          lastName: g.lastName,
          firstName: g.firstName,
          middleName: g.middleName?.trim() ?? '',
          visits: [visit],
        })
        return
      }
      existing.visits.push(visit)
      if (g.startDate > existing.visits[0].guest.startDate) {
        existing.lastName = g.lastName
        existing.firstName = g.firstName
        existing.middleName = g.middleName?.trim() ?? ''
      }
    })
    return [...groups.values()].map((group) => ({
      ...group,
      visits: [...group.visits].sort((a, b) => b.guest.startDate.localeCompare(a.guest.startDate)),
    }))
  }, [guests, rooms, bookingsByGuestId, bookingSubGuestsByBookingId, bookings])

  const tableColSpan = isAdmin ? 11 : 10

  const filteredGroups = useMemo(() => {
    const nf = qFirstName.trim().toLowerCase()
    const nl = qLastName.trim().toLowerCase()
    const ns = qSubGuestName.trim().toLowerCase()
    const list = profileGroups.filter((group) => {
      if (nf && !group.firstName.toLowerCase().includes(nf)) return false
      if (nl && !group.lastName.toLowerCase().includes(nl)) return false
      if (ns) {
        const hasSubGuestMatch = group.visits.some((visit) =>
          visit.subGuests.some((item) => {
          const fullName = [item.lastName, item.firstName, item.middleName?.trim()]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return fullName.includes(ns)
          }),
        )
        if (!hasSubGuestMatch) return false
      }
      if (qStartDate && !group.visits.some((visit) => visit.guest.startDate === qStartDate)) return false
      if (qEndDate && !group.visits.some((visit) => visit.guest.endDate === qEndDate)) return false
      if (qStatus === 'checked_in' && !group.visits.some((visit) => visit.status === 'checked_in')) return false
      if (qStatus === 'checked_out' && !group.visits.some((visit) => visit.status === 'checked_out')) return false
      return true
    })

    /** Для «Все»: заехали → без статуса → выехали; внутри — по ФИО. */
    function statusSortKey(group: GuestProfileGroup): number {
      if (group.visits.some((visit) => visit.status === 'checked_in')) return 0
      if (group.visits.some((visit) => visit.status === 'pending')) return 1
      return 2
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
  }, [
    profileGroups,
    qFirstName,
    qLastName,
    qSubGuestName,
    qStartDate,
    qEndDate,
    qStatus,
  ])

  return (
    <main className="flex min-h-screen w-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
            <Label htmlFor="gl-subguest" className="text-xs">
              Субгость (ФИО)
            </Label>
            <Input
              id="gl-subguest"
              value={qSubGuestName}
              onChange={(e) => setQSubGuestName(e.target.value)}
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
          Найдено профилей: {filteredGroups.length} из {profileGroups.length}
          {qStatus === 'all'
            ? ' · порядок: заехали, ожидают заезда, выехали'
            : null}
        </p>
      </section>

      <section className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-2 py-1.5 font-medium">Фамилия</th>
              <th className="px-2 py-1.5 font-medium">Имя</th>
              <th className="px-2 py-1.5 font-medium">Отчество</th>
              <th className="px-2 py-1.5 font-medium">ID профиля</th>
              <th className="min-w-[12rem] px-2 py-1.5 font-medium">Номер (по визитам)</th>
              <th className="min-w-[16rem] px-2 py-1.5 font-medium">Субгости</th>
              <th className="min-w-[9rem] px-2 py-1.5 font-medium">Заезд</th>
              <th className="min-w-[9rem] px-2 py-1.5 font-medium">Выезд</th>
              <th className="min-w-[8.5rem] px-2 py-1.5 font-medium leading-tight">
                Фактическая дата выезда
              </th>
              <th className="px-2 py-1.5 font-medium">Статус</th>
              {isAdmin ? (
                <th className="w-12 px-1 py-1.5 text-center font-medium" title="Только для роли администратор">
                  Удалить
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="px-2 py-6 text-center text-muted-foreground">
                  {loadError ? 'Нет данных.' : 'Нет записей по текущим условиям.'}
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const guestLabel = [group.lastName, group.firstName, group.middleName?.trim()]
                  .filter(Boolean)
                  .join(' ') || 'Гость'
                return (
                  <tr
                    key={group.key}
                    className="border-b border-border align-top transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-2 py-1.5 font-medium">{group.lastName}</td>
                    <td className="px-2 py-1.5">{group.firstName}</td>
                    <td className="max-w-[7rem] truncate px-2 py-1.5 text-muted-foreground">
                      {group.middleName || '—'}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                      {group.profileId || '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="space-y-2">
                        {group.visits.map((visit, visitIndex) => (
                          <button
                            key={`room-${visit.guest.id}`}
                            type="button"
                            className="block w-full rounded-md border border-border/60 bg-background/50 px-2 py-1 text-left text-muted-foreground hover:bg-muted/50"
                            onClick={() => setDialogGuestId(visit.guest.id)}
                            aria-label={`Карточка гостя: ${guestLabel}`}
                          >
                            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
                              Визит {visitIndex + 1}
                            </div>
                            <div className="truncate text-xs text-foreground">{visit.roomName}</div>
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top text-muted-foreground">
                      <div className="space-y-2">
                        {group.visits.map((visit) => (
                          <div key={`subs-${visit.guest.id}`} className="rounded-md border border-border/60 bg-background/50 px-2 py-1">
                            {visit.subGuests.length === 0 ? (
                              '—'
                            ) : (
                              <div className="space-y-0.5">
                                {visit.subGuests.map((item) => {
                                  const fullName = [item.lastName, item.firstName, item.middleName?.trim()]
                                    .filter(Boolean)
                                    .join(' ')
                                  return (
                                    <div key={item.id} className="truncate">
                                      Гость {item.position}: {fullName || 'Без имени'}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top tabular-nums">
                      <div className="space-y-2">
                        {group.visits.map((visit) => (
                          <div key={`checkin-${visit.guest.id}`} className="whitespace-nowrap rounded-md border border-border/60 bg-background/50 px-2 py-1">
                            {formatCheckInColumn(visit.guest.startDate, visit.guest.checkedInAt)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top tabular-nums">
                      <div className="space-y-2">
                        {group.visits.map((visit) => (
                          <div key={`checkout-${visit.guest.id}`} className="whitespace-nowrap rounded-md border border-border/60 bg-background/50 px-2 py-1">
                            {format(parseISO(visit.guest.endDate), 'dd.MM.yyyy', { locale: ru })}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top tabular-nums text-muted-foreground">
                      <div className="space-y-2">
                        {group.visits.map((visit) => (
                          <div key={`actual-${visit.guest.id}`} className="whitespace-nowrap rounded-md border border-border/60 bg-background/50 px-2 py-1">
                            {formatActualCheckout(visit.guest.checkedOutAt)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="space-y-2">
                        {group.visits.map((visit) => (
                          <div key={`status-${visit.guest.id}`} className="rounded-md border border-border/60 bg-background/50 px-2 py-1">
                            {visit.status === 'checked_out' ? (
                              <span className="rounded-md border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900 dark:border-red-800 dark:bg-red-950/70 dark:text-red-100">
                                Выехал
                              </span>
                            ) : visit.status === 'checked_in' ? (
                              <span className="rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">
                                Заехал
                              </span>
                            ) : (
                              <span className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
                                Не подтвержден
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="px-1 py-1.5 align-top">
                        <div className="space-y-2">
                          {group.visits.map((visit) => (
                            <div
                              key={`del-${visit.guest.id}`}
                              className="flex justify-center rounded-md border border-border/60 bg-background/50 px-1 py-1"
                            >
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 shrink-0 border-destructive/40 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={deletingGuestId === visit.guest.id}
                                title="Удалить карточку гостя и связанные брони"
                                onClick={() => void handleDeleteVisit(visit.guest.id, guestLabel)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </td>
                    ) : null}
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
