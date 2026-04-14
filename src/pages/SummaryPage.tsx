import {
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfWeek,
  format,
  max as maxDate,
  min as minDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/button'
import { fetchBookings, fetchGuests } from '@/lib/pms-db'
import { cn } from '@/lib/utils'
import type { Booking, Guest } from '@/types/models'

type PeriodKey = 'day' | 'week' | 'month'

const CARD = '#23262f'
const MUTED = '#6b7280'
const TRACK = '#3f3f46'
const LINE_GLOW = '#fbbf24'
const BAR_BLUE = '#3b82f6'
const BAR_PINK = '#ec4899'
const BAR_ORANGE = '#f59e0b'
const BAR_TEAL = '#14b8a6'

type ChartRow = { label: string; revenue: number; key: string }

type PeriodBounds = { start: Date; end: Date }

function periodBounds(period: PeriodKey): PeriodBounds {
  const now = new Date()
  if (period === 'day') {
    const endDay = startOfDay(now)
    const startDay = subDays(endDay, 6)
    return { start: startDay, end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) }
  }
  if (period === 'week') return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
  return { start: startOfMonth(now), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) }
}

/**
 * Календарный день заезда yyyy-MM-dd.
 * Для даты из Postgres `YYYY-MM-DD` не используем parseISO — в JS это UTC-полночь и день «плывёт» в других поясах.
 */
function bookingStartDateKey(booking: Booking): string | null {
  const raw = booking.startDate?.trim()
  if (!raw) return null
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  if (ymd) return ymd[1]!
  const d = parseISO(raw)
  if (Number.isNaN(d.getTime())) return null
  return format(d, 'yyyy-MM-dd')
}

/** Бронь учитывается, если дата заезда попадает в интервал (по дню). */
function bookingStartsInRange(booking: Booking, rangeStart: Date, rangeEnd: Date): boolean {
  const key = bookingStartDateKey(booking)
  if (!key) return false
  const lo = format(startOfDay(rangeStart), 'yyyy-MM-dd')
  const hi = format(startOfDay(rangeEnd), 'yyyy-MM-dd')
  return key >= lo && key <= hi
}

/** Выручка по брони: только при payment_status = paid на брони (сводка синхронизирована с карточкой гостя). */
function bookingPaidAmount(booking: Booking): number {
  if (booking.paymentStatus !== 'paid') return 0
  const n = Number(booking.totalPrice)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

function sumRevenueForDay(bookings: Booking[], day: Date): number {
  const dayKey = format(startOfDay(day), 'yyyy-MM-dd')
  let sum = 0
  for (const b of bookings) {
    const key = bookingStartDateKey(b)
    if (key !== dayKey) continue
    sum += bookingPaidAmount(b)
  }
  return sum
}

function sumRevenueInRange(bookings: Booking[], rangeStart: Date, rangeEnd: Date): number {
  const lo = format(startOfDay(rangeStart), 'yyyy-MM-dd')
  const hi = format(startOfDay(rangeEnd), 'yyyy-MM-dd')
  let sum = 0
  for (const b of bookings) {
    const key = bookingStartDateKey(b)
    if (!key || key < lo || key > hi) continue
    sum += bookingPaidAmount(b)
  }
  return sum
}

/** Серия для графиков: зависит от периода */
function buildRevenueSeries(period: PeriodKey, bounds: PeriodBounds, allBookings: Booking[]): ChartRow[] {
  if (period === 'day' || period === 'week') {
    const days = eachDayOfInterval({ start: bounds.start, end: startOfDay(bounds.end) })
    return days.map((d) => ({
      key: format(d, 'yyyy-MM-dd'),
      label: format(d, 'EE', { locale: ru }),
      revenue: sumRevenueForDay(allBookings, d),
    }))
  }
  const weeks = eachWeekOfInterval({ start: bounds.start, end: bounds.end }, { weekStartsOn: 1 })
  return weeks.map((wStart, i) => {
    const wEnd = endOfWeek(wStart, { weekStartsOn: 1 })
    const clipStart = maxDate([wStart, bounds.start])
    const clipEnd = minDate([wEnd, bounds.end])
    return {
      key: `w-${i}-${format(wStart, 'yyyy-MM-dd')}`,
      label: `Нед ${i + 1}`,
      revenue: sumRevenueInRange(allBookings, clipStart, clipEnd),
    }
  })
}

function formatAxisRub(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(Math.round(n))
}

function formatMoneyRu(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`
}

function barColorsFor(rows: ChartRow[]): string[] {
  const indexed = rows.map((r, i) => ({ i, revenue: r.revenue }))
  const sorted = [...indexed].sort((a, b) => b.revenue - a.revenue)
  const rankByIndex = new Map<number, number>()
  sorted.forEach((item, rank) => rankByIndex.set(item.i, rank))
  const palette = [BAR_BLUE, BAR_PINK, BAR_ORANGE]
  return rows.map((_, i) => {
    const rank = rankByIndex.get(i) ?? 99
    if (rank < 3 && rows[i]!.revenue > 0) return palette[rank]!
    return TRACK
  })
}

type DonutProps = {
  title: string
  percent: number
  primaryLabel: string
  primaryValue: number
  secondaryLabel: string
  secondaryValue: number
  accent: string
}

function DonutMetric({ title, percent, primaryLabel, primaryValue, secondaryLabel, secondaryValue, accent }: DonutProps) {
  const data = [
    { name: primaryLabel, value: Math.max(0, primaryValue), fill: accent },
    { name: secondaryLabel, value: Math.max(0, secondaryValue), fill: TRACK },
  ]
  const total = data[0]!.value + data[1]!.value
  const showPie = total > 0

  return (
    <article
      className="flex flex-col rounded-xl border border-white/5 p-4"
      style={{ backgroundColor: CARD }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/90">{title}</h3>
        <button type="button" className="rounded p-1 text-white/40 hover:text-white/70" aria-label="Ещё">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div className="relative mx-auto flex h-[200px] w-full max-w-[220px] items-center justify-center">
        {showPie ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={78}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                paddingAngle={0}
                style={{
                  filter: `drop-shadow(0 0 6px ${accent}55)`,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-sm text-white/40">Нет данных</div>
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-white">{percent}%</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: accent }} />
          {primaryLabel} ({Math.round(primaryValue).toLocaleString('ru-RU')})
        </span>
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TRACK }} />
          {secondaryLabel} ({Math.round(secondaryValue).toLocaleString('ru-RU')})
        </span>
      </div>
    </article>
  )
}

const chartTooltipStyle = {
  backgroundColor: CARD,
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#fff',
  fontSize: 12,
}

export default function SummaryPage() {
  const [period, setPeriod] = useState<PeriodKey>('week')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadError('')
      try {
        const [nextBookings, nextGuests] = await Promise.all([fetchBookings(), fetchGuests()])
        if (cancelled) return
        setBookings(nextBookings)
        setGuests(nextGuests)
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить сводные данные.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const bounds = useMemo(() => periodBounds(period), [period])

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])

  const periodBookings = useMemo(
    () => bookings.filter((b) => bookingStartsInRange(b, bounds.start, bounds.end)),
    [bookings, bounds.start, bounds.end],
  )

  const revenueSeries = useMemo(() => buildRevenueSeries(period, bounds, bookings), [period, bounds, bookings])

  /** Без NaN: Math.max(1, …, NaN) === NaN ломает domain у Recharts. */
  const chartMax = useMemo(() => {
    let m = 0
    for (const r of revenueSeries) {
      const v = Number(r.revenue)
      if (Number.isFinite(v) && v > m) m = v
    }
    return m > 0 ? m : 1
  }, [revenueSeries])

  const totalSalesInSeries = useMemo(() => revenueSeries.reduce((s, r) => s + r.revenue, 0), [revenueSeries])

  const periodPaidTotal = useMemo(() => {
    return periodBookings.reduce((sum, b) => sum + bookingPaidAmount(b), 0)
  }, [periodBookings])

  const periodInvoicedTotal = useMemo(() => {
    return periodBookings.reduce((sum, b) => {
      const n = Number(b.totalPrice)
      return sum + (Number.isFinite(n) && n > 0 ? n : 0)
    }, 0)
  }, [periodBookings])

  const paidBookingsCount = useMemo(() => {
    return periodBookings.filter((b) => b.paymentStatus === 'paid').length
  }, [periodBookings])

  const unpaidBookingsCount = useMemo(() => Math.max(0, periodBookings.length - paidBookingsCount), [periodBookings.length, paidBookingsCount])

  const successfulPct = useMemo(() => {
    if (periodBookings.length === 0) return 0
    return Math.round((100 * paidBookingsCount) / periodBookings.length)
  }, [periodBookings.length, paidBookingsCount])

  /** Оплаченные брони в периоде: способ из карточки гостя (`guests.payment_method`). */
  const paidMethodStats = useMemo(() => {
    let cash = 0
    let transfer = 0
    let unknown = 0
    for (const b of periodBookings) {
      if (b.paymentStatus !== 'paid') continue
      const method = b.guestId ? guestById.get(b.guestId)?.paymentMethod : undefined
      if (method === 'cash') cash++
      else if (method === 'transfer') transfer++
      else unknown++
    }
    const channel = cash + transfer
    const transferSharePct = channel > 0 ? Math.round((100 * transfer) / channel) : 0
    return { cash, transfer, unknown, transferSharePct }
  }, [periodBookings, guestById])

  const profileVisitCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of guests) {
      if (!g.profileId) continue
      m.set(g.profileId, (m.get(g.profileId) ?? 0) + 1)
    }
    return m
  }, [guests])

  const returningStats = useMemo(() => {
    const profilesInPeriod = new Set<string>()
    for (const b of periodBookings) {
      if (!b.guestId) continue
      const g = guestById.get(b.guestId)
      if (g?.profileId) profilesInPeriod.add(g.profileId)
    }
    let returning = 0
    for (const pid of profilesInPeriod) {
      if ((profileVisitCount.get(pid) ?? 0) > 1) returning += 1
    }
    const total = profilesInPeriod.size
    const newGuests = Math.max(0, total - returning)
    const pct = total > 0 ? Math.round((100 * returning) / total) : 0
    return { returning, newGuests, total, pct }
  }, [periodBookings, guestById, profileVisitCount])

  const salesTargetPct = useMemo(() => {
    if (periodInvoicedTotal <= 0) return 0
    return Math.min(100, Math.round((100 * periodPaidTotal) / periodInvoicedTotal))
  }, [periodPaidTotal, periodInvoicedTotal])

  const barColors = useMemo(() => barColorsFor(revenueSeries), [revenueSeries])

  const lineTicks = useMemo(() => {
    const step = chartMax / 4
    return [0, step, step * 2, step * 3, chartMax].map((x) => Math.round(x))
  }, [chartMax])

  const chartCaption =
    period === 'day'
      ? 'Последние 7 дней по дате заезда; выручка только при статусе «оплачен» на брони'
      : period === 'week'
        ? 'Текущая календарная неделя'
        : 'Недели выбранного месяца'

  return (
    <main className="min-h-screen w-full bg-background p-4 sm:p-6 text-foreground">
      <header className="mx-auto mb-6 max-w-7xl space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Сводные данные</h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            Графики и доли оплаты считаются по статусу оплаты на брони (оплачен / не оплачен); при сохранении брони статус совпадает с карточкой гостя.
          </p>
          {loadError ? <p className="mt-2 text-sm text-red-400">{loadError}</p> : null}
        </div>
        <div className="inline-flex rounded-lg border border-white/10 p-1" style={{ backgroundColor: CARD }}>
          {([
            ['day', 'День'],
            ['week', 'Неделя'],
            ['month', 'Месяц'],
          ] as const).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className={cn(
                'h-9 border-white/15 bg-transparent px-4 text-white/80 hover:bg-white/10 hover:text-white',
                period === key && 'bg-white/15 text-white',
              )}
              onClick={() => setPeriod(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        {/* Revenue line */}
        <article
          className="rounded-xl border border-white/5 p-4 lg:col-span-2"
          style={{ backgroundColor: CARD }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium text-white">Выручка</h2>
            <button type="button" className="rounded p-1 text-white/40 hover:text-white/70" aria-label="Ещё">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={formatAxisRub}
                  tick={{ fill: MUTED, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, chartMax]}
                  ticks={lineTicks}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value) => [formatMoneyRu(Number(value)), 'Выручка']}
                  labelFormatter={(_, payload) => (payload?.[0]?.payload?.label ? String(payload[0].payload.label) : '')}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={LINE_GLOW}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#fff', stroke: LINE_GLOW, strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  style={{ filter: 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.85))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-xs" style={{ color: MUTED }}>
            {chartCaption}
          </p>
        </article>

        {/* Total sales bar */}
        <article className="rounded-xl border border-white/5 p-4" style={{ backgroundColor: CARD }}>
          <h2 className="text-base font-medium text-white">Всего продаж</h2>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-white">
            {formatMoneyRu(totalSalesInSeries)}
          </p>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>
            Сумма оплат по броням с заездом в интервале графика (как на линии выше)
          </p>
          <div className="mt-4 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, chartMax]} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value) => [formatMoneyRu(Number(value)), 'Продажи']}
                />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={40}>
                  {revenueSeries.map((_, i) => (
                    <Cell
                      key={revenueSeries[i]!.key}
                      fill={barColors[i]}
                      style={{
                        filter:
                          barColors[i] !== TRACK
                            ? `drop-shadow(0 0 6px ${barColors[i]}88)`
                            : undefined,
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        {/* Donuts */}
        <DonutMetric
          title="Успешные оплаты"
          percent={successfulPct}
          primaryLabel="Оплачено"
          primaryValue={paidBookingsCount}
          secondaryLabel="Не оплачено"
          secondaryValue={unpaidBookingsCount}
          accent={BAR_BLUE}
        />
        <div className="flex min-w-0 flex-col">
          <DonutMetric
            title="Способ оплаты"
            percent={paidMethodStats.transferSharePct}
            primaryLabel="Наличные"
            primaryValue={paidMethodStats.cash}
            secondaryLabel="Безналичные"
            secondaryValue={paidMethodStats.transfer}
            accent={BAR_TEAL}
          />
          {paidMethodStats.unknown > 0 ? (
            <p className="mt-1 text-center text-[10px]" style={{ color: MUTED }}>
              Без карточки гостя или способ не задан: {paidMethodStats.unknown}
            </p>
          ) : null}
        </div>
        <DonutMetric
          title="Повторные гости"
          percent={returningStats.pct}
          primaryLabel="Повторный визит"
          primaryValue={returningStats.returning}
          secondaryLabel="Новые в периоде"
          secondaryValue={returningStats.newGuests}
          accent={BAR_ORANGE}
        />
        <DonutMetric
          title="Собрано по счетам"
          percent={salesTargetPct}
          primaryLabel="Оплачено"
          primaryValue={periodPaidTotal}
          secondaryLabel="Не оплачено"
          secondaryValue={Math.max(0, periodInvoicedTotal - periodPaidTotal)}
          accent={BAR_PINK}
        />
      </div>

      <footer className="mx-auto mt-8 max-w-7xl text-xs" style={{ color: MUTED }}>
        Период метрик (кольца и итог справа в «Всего продаж» для месяца):{' '}
        {format(bounds.start, 'dd.MM.yyyy', { locale: ru })} — {format(bounds.end, 'dd.MM.yyyy', { locale: ru })}. Учитываются брони с
        заездом в периоде; в выручку входят только брони со статусом «оплачен». Способ оплаты — по полю гостя в БД
        (наличные / безналичные) для оплаченных броней с привязкой к карточке гостя.
      </footer>
    </main>
  )
}
