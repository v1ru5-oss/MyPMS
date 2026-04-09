import { format, isWithinInterval, parseISO } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Calendar } from '@/components/ui/calendar'
import { formatCheckInTimeShort, formatCheckOutTimeShort } from '@/lib/booking-check-in-time'
import { formatGuestFullName } from '@/lib/guest-name'
import { fetchBookings, fetchGuests, fetchRooms } from '@/lib/pms-db'
import { type Booking, type Guest, type Room } from '@/types/models'

export default function SummaryPage() {
  const location = useLocation()
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loadError, setLoadError] = useState('')
  const [selectedDay, setSelectedDay] = useState<Date>(new Date())

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

  const bookedDates = useMemo(() => {
    return bookings.flatMap((booking) => {
      const from = parseISO(booking.startDate)
      const to = parseISO(booking.endDate)
      const days: Date[] = []
      for (
        let current = new Date(from);
        current <= to;
        current.setDate(current.getDate() + 1)
      ) {
        days.push(new Date(current))
      }
      return days
    })
  }, [bookings])

  const selectedDayBookings = useMemo(() => {
    return bookings.filter((booking) =>
      isWithinInterval(selectedDay, {
        start: parseISO(booking.startDate),
        end: parseISO(booking.endDate),
      }),
    )
  }, [bookings, selectedDay])

  return (
    <main className="flex min-h-screen w-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">Сводные данные</h1>
          <p className="text-sm text-muted-foreground">
            Календарь броней, список гостей и брони на выбранную дату. Данные из Supabase.
          </p>
          {loadError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {loadError}
            </p>
          ) : null}
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-6">
          <Calendar
            mode="single"
            selected={selectedDay}
            onSelect={(day) => day && setSelectedDay(day)}
            modifiers={{ booked: bookedDates }}
            modifiersClassNames={{ booked: 'bg-amber-200 text-amber-900' }}
          />

          <div className="rounded-lg border p-4">
            <h2 className="mb-1 text-xl font-medium">Все гости</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Список из таблицы Guest. Нажмите на строку, чтобы открыть карточку.
            </p>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {guests.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  Пока нет гостей — добавьте бронь на главной (кнопка «Добавить бронь» или меню слева).
                </li>
              ) : (
                guests.map((guest) => {
                  const room = rooms.find((r) => r.id === guest.roomId)
                  return (
                    <li key={guest.id}>
                      <Link
                        to={`/guest/${guest.id}`}
                        className="block rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:border-input hover:bg-muted/50"
                      >
                        <span className="font-medium">{formatGuestFullName(guest)}</span>
                        {guest.checkedOutAt ? (
                          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Выехал
                          </span>
                        ) : null}
                        <span className="text-muted-foreground">
                          {' '}
                          · {room?.name ?? guest.roomId} · заезд{' '}
                          {format(parseISO(guest.startDate), 'dd.MM.yyyy')} — выезд{' '}
                          {format(parseISO(guest.endDate), 'dd.MM.yyyy')}
                        </span>
                      </Link>
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="mb-1 text-xl font-medium">
            Брони на {format(selectedDay, 'dd.MM.yyyy')}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Отмеченные в календаре даты показывают дни с активными бронями.
          </p>

          <div className="space-y-3">
            {selectedDayBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                На эту дату броней пока нет.
              </p>
            ) : (
              selectedDayBookings.map((booking) => {
                const room = rooms.find((r) => r.id === booking.roomId)
                return (
                  <article key={booking.id} className="rounded-md border p-3">
                    <p className="font-medium">{booking.guestName}</p>
                    <p className="text-sm text-muted-foreground">
                      {room?.name ?? booking.roomId} | {booking.startDate}
                      {formatCheckInTimeShort(booking.checkInTime)
                        ? ` ${formatCheckInTimeShort(booking.checkInTime)}`
                        : ''}{' '}
                      — {booking.endDate}
                      {formatCheckOutTimeShort(booking.checkOutTime)
                        ? ` ${formatCheckOutTimeShort(booking.checkOutTime)}`
                        : ''}
                    </p>
                    {booking.note ? (
                      <p className="mt-1 text-sm text-muted-foreground">{booking.note}</p>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
