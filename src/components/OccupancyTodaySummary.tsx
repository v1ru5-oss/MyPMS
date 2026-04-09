import { format } from 'date-fns'
import { CircleHelp } from 'lucide-react'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import { type Booking, type Guest, type Room } from '@/types/models'

type Props = {
  rooms: Room[]
  bookings: Booking[]
  guests: Guest[]
  className?: string
}

/** Фон бейджа процента: 0% — красный, 100% — зелёный, между — через жёлтый (hue 0→120). */
function loadPercentToBadgeColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent)) / 100
  const h = Math.round(p * 120)
  return `hsl(${h} 72% 42%)`
}

/** Номер занят сегодня, если есть бронь, пересекающаяся с календарным днём (как на шахматке). */
function isRoomOccupiedToday(roomId: string, todayKey: string, bookings: Booking[]): boolean {
  return bookings.some(
    (b) => b.roomId === roomId && b.startDate <= todayKey && b.endDate >= todayKey,
  )
}

export function OccupancyTodaySummary({ rooms, bookings, guests, className }: Props) {
  const stats = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    let occupiedCount = 0
    for (const r of rooms) {
      if (isRoomOccupiedToday(r.id, todayKey, bookings)) occupiedCount += 1
    }
    const totalRooms = rooms.length
    const loadPercent =
      totalRooms > 0 ? Math.min(100, Math.round((occupiedCount / totalRooms) * 100)) : 0

    const guestsWithStayToday = guests.filter((g) => {
      if (g.checkedOutAt) return false
      return g.startDate <= todayKey && g.endDate >= todayKey
    }).length

    return { occupiedCount, totalRooms, loadPercent, guestsWithStayToday }
  }, [rooms, bookings, guests])

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-background p-4 shadow-sm dark:bg-card',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight text-foreground">
          Загрузка на сегодня
        </h3>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted"
          title="Доля занятых номеров по всем категориям: активная бронь на сегодня. Отдельно — число карточек Guest с проживанием на эту дату."
          aria-label="Справка по загрузке на сегодня"
        >
          <CircleHelp className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-stretch gap-4">
        <div
          className="flex h-[4.5rem] w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-md text-center text-lg font-bold leading-none text-white shadow-sm"
          style={{ backgroundColor: loadPercentToBadgeColor(stats.loadPercent) }}
          aria-label={`Загрузка ${stats.loadPercent} процентов`}
        >
          {stats.loadPercent}%
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 text-sm">
          <p className="text-foreground">
            <span className="font-semibold tabular-nums">{stats.occupiedCount}</span>{' '}
            <span className="text-muted-foreground">занято</span>
          </p>
          <p className="text-foreground">
            <span className="font-semibold tabular-nums">{stats.totalRooms}</span>{' '}
            <span className="text-muted-foreground">всего номеров</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Гостей по карточкам на сегодня:{' '}
            <span className="font-medium tabular-nums text-foreground">
              {stats.guestsWithStayToday}
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}
