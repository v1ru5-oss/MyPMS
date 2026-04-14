import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  isSaturday,
  isSunday,
  parseISO,
  startOfDay,
  startOfMonth,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { Check, ChevronDown, ChevronRight, CircleDashed, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  bookingBarLayoutPx,
  formatCheckInTimeShort,
  formatCheckOutTimeShort,
} from '@/lib/booking-check-in-time'
import {
  checkInUrgentWithinTwoHours,
  findNextCheckInForRoom,
  formatNextCheckInHoverTitle,
} from '@/lib/next-room-checkin'
import { cn } from '@/lib/utils'
import { type Booking, type Room, type RoomClosure } from '@/types/models'

function roomCleaningToggleTitle(status: Room['cleaningStatus']): string {
  if (status === 'clean') return 'Убрано — клик: не убрано'
  if (status === 'dirty') return 'Не убрано — клик: снять отметку'
  return 'Без отметки — клик: убрано'
}

const LABEL_COL_PX = 220
const DAY_COL_PX = 36
/** Порог смещения указателя: меньше — считаем кликом (открыть карточку), больше — перенос брони */
const BOOKING_CLICK_MAX_PX = 6
/** Дней слева и справа от просматриваемого месяца в сетке */
const MONTH_PAD_DAYS = 2

function groupRoomsByCategory(rooms: Room[]): { category: string; rooms: Room[] }[] {
  const map = new Map<string, Room[]>()
  for (const room of rooms) {
    const c = room.category ?? 'Без категории'
    if (!map.has(c)) map.set(c, [])
    map.get(c)!.push(room)
  }
  return Array.from(map.entries()).map(([category, list]) => ({
    category,
    rooms: list.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  }))
}

function bookingOverlapsRange(b: Booking, fromKey: string, toKey: string): boolean {
  return b.startDate <= toKey && b.endDate >= fromKey
}

function clampBookingToGrid(
  b: Booking,
  gridStartKey: string,
  gridEndKey: string,
): { start: string; end: string } | null {
  if (!bookingOverlapsRange(b, gridStartKey, gridEndKey)) return null
  return {
    start: b.startDate < gridStartKey ? gridStartKey : b.startDate,
    end: b.endDate > gridEndKey ? gridEndKey : b.endDate,
  }
}

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function getClosureSegmentForDay(
  closure: RoomClosure,
  day: Date,
): { startPercent: number; endPercent: number } | null {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)
  const closureStart = parseISO(closure.startAt)
  const closureEnd = parseISO(closure.endAt)
  if (Number.isNaN(closureStart.getTime()) || Number.isNaN(closureEnd.getTime())) return null

  const overlapStart = closureStart > dayStart ? closureStart : dayStart
  const overlapEnd = closureEnd < dayEnd ? closureEnd : dayEnd
  if (overlapEnd <= overlapStart) return null

  const dayMs = dayEnd.getTime() - dayStart.getTime()
  const startPercent = ((overlapStart.getTime() - dayStart.getTime()) / dayMs) * 100
  const endPercent = ((overlapEnd.getTime() - dayStart.getTime()) / dayMs) * 100
  return { startPercent, endPercent }
}

/** Доля прошедшего времени в локальных сутках [0, 1] — для метки «сейчас» в колонке дня. */
function fractionOfLocalDay(now: Date): number {
  const sod = startOfDay(now)
  const elapsed = now.getTime() - sod.getTime()
  return Math.min(1, Math.max(0, elapsed / 86_400_000))
}

/** Свободных номеров в категории в эту ночь (день D: занят, если бронь пересекает D) */
function freeCountForCategory(
  categoryRooms: Room[],
  dayKeyStr: string,
  bookings: Booking[],
): number {
  return categoryRooms.filter((room) => {
    const busy = bookings.some(
      (b) =>
        b.roomId === room.id && b.startDate <= dayKeyStr && b.endDate >= dayKeyStr,
    )
    return !busy
  }).length
}

type Props = {
  rooms: Room[]
  bookings: Booking[]
  roomClosures?: RoomClosure[]
  /** Клик по дате или выделение диапазона в строке номера — открыть форму новой брони */
  onNewBookingRequest?: (params: { roomId: string; startDate: string; endDate: string }) => void
  /** Перенос / изменение дат существующей брони; вернуть false, если пересечение с другой бронью */
  onBookingDatesChange?: (
    bookingId: string,
    next: { startDate: string; endDate: string },
  ) => boolean
  /** Клик по полосе брони (без перетаскивания) — редактирование гостя и номера */
  onBookingEditClick?: (booking: Booking) => void
  /** Админ / горничная: клик по значку уборки — тот же цикл, что на «Уборка в номерах» */
  onRoomCleaningStatusClick?: (roomId: string) => void
  /** Пока идёт сохранение статуса уборки для этого номера */
  roomCleaningSavingRoomId?: string | null
  /** Гости, к которым привязаны заметки — на полосе брони показывается «!» */
  guestIdsWithStickyNotes?: ReadonlySet<string>
  /** Клик по периоду закрытия номера (красная ячейка) — открыть редактирование закрытия */
  onRoomClosureClick?: (closure: RoomClosure) => void
}

type DragRef = { roomId: string; anchor: number; end: number }

type BookingDragSession =
  | {
      kind: 'move'
      bookingId: string
      roomId: string
      start0: string
      end0: string
      anchorDateKey: string
      startClientX: number
    }
  | {
      kind: 'resize-start'
      bookingId: string
      roomId: string
      start0: string
      endFixed: string
      startClientX: number
    }
  | {
      kind: 'resize-end'
      bookingId: string
      roomId: string
      startFixed: string
      end0: string
      startClientX: number
    }

export function BookingShakhmatka({
  rooms,
  bookings,
  roomClosures = [],
  onNewBookingRequest,
  onBookingDatesChange,
  onBookingEditClick,
  onRoomCleaningStatusClick,
  roomCleaningSavingRoomId = null,
  guestIdsWithStickyNotes,
  onRoomClosureClick,
}: Props) {
  /** Любой день просматриваемого месяца (для поля даты и «Сегодня»); сетка строится от начала этого месяца */
  const [viewAnchor, setViewAnchor] = useState(() => new Date())
  const viewMonth = useMemo(() => startOfMonth(viewAnchor), [viewAnchor])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  /** Подсветка ячеек при выделении диапазона (индексы колонок дней) */
  const [rangePreview, setRangePreview] = useState<{
    roomId: string
    i0: number
    i1: number
  } | null>(null)
  /** Визуальный превью дат брони при перетаскивании */
  const [bookingLive, setBookingLive] = useState<{
    bookingId: string
    startDate: string
    endDate: string
  } | null>(null)

  /** Дни месяца + по MONTH_PAD_DAYS с каждой стороны (соседние даты визуально приглушены). */
  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth)
    const monthEnd = endOfMonth(viewMonth)
    const gridStart = addDays(monthStart, -MONTH_PAD_DAYS)
    const gridEnd = addDays(monthEnd, MONTH_PAD_DAYS)
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [viewMonth])

  const gridCols = useMemo(
    () => `${LABEL_COL_PX}px repeat(${days.length}, minmax(${DAY_COL_PX}px, 1fr))`,
    [days.length],
  )

  const dragRef = useRef<DragRef | null>(null)
  const gridBodyRef = useRef<HTMLDivElement>(null)
  const dayColWidthRef = useRef(DAY_COL_PX)
  const [dayColWidthPx, setDayColWidthPx] = useState(DAY_COL_PX)
  const daysRef = useRef(days)
  daysRef.current = days
  const bookingsRef = useRef(bookings)
  bookingsRef.current = bookings
  const previewKeyRef = useRef<string | null>(null)
  const moveListenerRef = useRef<((e: PointerEvent) => void) | null>(null)
  const bookingDragSessionRef = useRef<BookingDragSession | null>(null)
  const bookingDragMoveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const bookingLiveRef = useRef<{ bookingId: string; startDate: string; endDate: string } | null>(
    null,
  )

  useLayoutEffect(() => {
    const el = gridBodyRef.current
    if (!el || days.length === 0) return
    const measure = () => {
      const w = el.clientWidth
      const dayW = Math.max(DAY_COL_PX, (w - LABEL_COL_PX) / days.length)
      dayColWidthRef.current = dayW
      setDayColWidthPx(dayW)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [days.length])

  useEffect(() => {
    return () => {
      if (moveListenerRef.current) {
        window.removeEventListener('pointermove', moveListenerRef.current)
        moveListenerRef.current = null
      }
      if (bookingDragMoveRef.current) {
        window.removeEventListener('pointermove', bookingDragMoveRef.current)
        bookingDragMoveRef.current = null
      }
      dragRef.current = null
      bookingDragSessionRef.current = null
    }
  }, [])

  const gridStartKey = dayKey(days[0]!)
  const gridEndKey = dayKey(days[days.length - 1]!)
  /** Пульс для метки «сейчас» в колонке дня (каждые 30 с + при возврате на вкладку). */
  const [clockPulse, setClockPulse] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setClockPulse((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  /** Обновление даты «сегодня» на сетке (полночь, возврат на вкладку). */
  const [todayTick, setTodayTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTodayTick((t) => t + 1), 60_000)
    const onVis = () => {
      setTodayTick((t) => t + 1)
      setClockPulse((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  const nowForTimeLine = useMemo(() => new Date(), [todayTick, clockPulse])

  const todayColumnIndex = useMemo(
    () => days.findIndex((d) => isSameDay(d, nowForTimeLine)),
    [days, nowForTimeLine],
  )
  const todayTimeLineLeftPx =
    todayColumnIndex >= 0 && days.length > 0
      ? LABEL_COL_PX +
        todayColumnIndex * dayColWidthPx +
        fractionOfLocalDay(nowForTimeLine) * dayColWidthPx
      : null

  const categories = useMemo(() => groupRoomsByCategory(rooms), [rooms])
  const roomClosuresByRoomId = useMemo(() => {
    const map = new Map<string, RoomClosure[]>()
    roomClosures.forEach((item) => {
      const list = map.get(item.roomId) ?? []
      list.push(item)
      map.set(item.roomId, list)
    })
    return map
  }, [roomClosures])

  const dayIndex = (key: string) => days.findIndex((d) => dayKey(d) === key)

  function toggleCategory(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function handleCellPointerEnter(roomId: string, dayIndex: number) {
    const dr = dragRef.current
    if (!dr || dr.roomId !== roomId) return
    dr.end = dayIndex
    const i0 = Math.min(dr.anchor, dr.end)
    const i1 = Math.max(dr.anchor, dr.end)
    const key = `${i0}-${i1}`
    if (previewKeyRef.current === key) return
    previewKeyRef.current = key
    setRangePreview({ roomId: dr.roomId, i0, i1 })
  }

  const beginCellDrag = useCallback(
    (roomId: string, dayIndex: number, e: React.PointerEvent) => {
      if (!onNewBookingRequest || e.button !== 0) return
      e.preventDefault()
      if (moveListenerRef.current) {
        window.removeEventListener('pointermove', moveListenerRef.current)
        moveListenerRef.current = null
      }

      dragRef.current = { roomId, anchor: dayIndex, end: dayIndex }
      previewKeyRef.current = `${dayIndex}-${dayIndex}`
      setRangePreview({ roomId, i0: dayIndex, i1: dayIndex })

      const onMove = (ev: PointerEvent) => {
        const dr = dragRef.current
        if (!dr) return
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const cell = el?.closest('[data-shakh-day-cell]') as HTMLElement | null
        if (!cell) return
        const rId = cell.dataset.roomId
        const idxRaw = cell.dataset.dayIndex
        if (rId !== dr.roomId || idxRaw === undefined) return
        const di = parseInt(idxRaw, 10)
        if (Number.isNaN(di)) return
        dr.end = di
        const i0 = Math.min(dr.anchor, dr.end)
        const i1 = Math.max(dr.anchor, dr.end)
        const key = `${i0}-${i1}`
        if (previewKeyRef.current === key) return
        previewKeyRef.current = key
        setRangePreview({ roomId: dr.roomId, i0, i1 })
      }

      const onUpOrCancel = () => {
        window.removeEventListener('pointermove', onMove)
        moveListenerRef.current = null

        const dr = dragRef.current
        dragRef.current = null
        previewKeyRef.current = null
        setRangePreview(null)

        if (!dr || !onNewBookingRequest) return
        const d = daysRef.current
        const i0 = Math.min(dr.anchor, dr.end)
        const i1 = Math.max(dr.anchor, dr.end)
        const d0 = d[i0]
        const d1 = d[i1]
        if (!d0 || !d1) return
        onNewBookingRequest({
          roomId: dr.roomId,
          startDate: dayKey(d0),
          endDate: dayKey(d1),
        })
      }

      moveListenerRef.current = onMove
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUpOrCancel, { once: true })
      window.addEventListener('pointercancel', onUpOrCancel, { once: true })
    },
    [onNewBookingRequest],
  )

  function cancelNewBookingDragIfAny() {
    if (moveListenerRef.current) {
      window.removeEventListener('pointermove', moveListenerRef.current)
      moveListenerRef.current = null
    }
    dragRef.current = null
    previewKeyRef.current = null
    setRangePreview(null)
  }

  function getCellDayAtPoint(cx: number, cy: number): { roomId: string; dayKey: string } | null {
    const el = document.elementFromPoint(cx, cy)
    const cell = el?.closest('[data-shakh-day-cell]') as HTMLElement | null
    if (!cell?.dataset.roomId || cell.dataset.dayIndex === undefined) return null
    const idx = parseInt(cell.dataset.dayIndex, 10)
    if (Number.isNaN(idx)) return null
    const d = daysRef.current[idx]
    if (!d) return null
    return { roomId: cell.dataset.roomId, dayKey: dayKey(d) }
  }

  function finalizeBookingDragFromLive() {
    const live = bookingLiveRef.current
    bookingLiveRef.current = null
    setBookingLive(null)
    bookingDragSessionRef.current = null

    if (!live || !onBookingDatesChange) return
    const original = bookingsRef.current.find((b) => b.id === live.bookingId)
    if (!original) return
    if (original.startDate === live.startDate && original.endDate === live.endDate) return
    onBookingDatesChange(live.bookingId, {
      startDate: live.startDate,
      endDate: live.endDate,
    })
  }

  function attachBookingDragEnd(onMove: (e: PointerEvent) => void) {
    if (bookingDragMoveRef.current) {
      window.removeEventListener('pointermove', bookingDragMoveRef.current)
    }
    bookingDragMoveRef.current = onMove
    window.addEventListener('pointermove', onMove)

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      bookingDragMoveRef.current = null
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      finalizeBookingDragFromLive()
    }
    window.addEventListener('pointerup', onEnd, { once: true })
    window.addEventListener('pointercancel', onEnd, { once: true })
  }

  const startBookingMove = useCallback(
    (booking: Booking, roomId: string, clientX: number, clientY: number) => {
      if (!onBookingDatesChange) return
      cancelNewBookingDragIfAny()

      const cell = getCellDayAtPoint(clientX, clientY)
      const anchorDateKey = cell?.roomId === roomId ? cell.dayKey : booking.startDate

      bookingDragSessionRef.current = {
        kind: 'move',
        bookingId: booking.id,
        roomId,
        start0: booking.startDate,
        end0: booking.endDate,
        anchorDateKey,
        startClientX: clientX,
      }
      const initial = {
        bookingId: booking.id,
        startDate: booking.startDate,
        endDate: booking.endDate,
      }
      bookingLiveRef.current = initial
      setBookingLive(initial)

      const onMove = (e: PointerEvent) => {
        const session = bookingDragSessionRef.current
        if (!session || session.kind !== 'move') return
        let nextStart: string
        let nextEnd: string
        const hit = getCellDayAtPoint(e.clientX, e.clientY)
        if (hit && hit.roomId === session.roomId) {
          const delta = differenceInCalendarDays(
            parseISO(hit.dayKey),
            parseISO(session.anchorDateKey),
          )
          nextStart = format(addDays(parseISO(session.start0), delta), 'yyyy-MM-dd')
          nextEnd = format(addDays(parseISO(session.end0), delta), 'yyyy-MM-dd')
        } else {
          const deltaDays = Math.round(
            (e.clientX - session.startClientX) / dayColWidthRef.current,
          )
          nextStart = format(addDays(parseISO(session.start0), deltaDays), 'yyyy-MM-dd')
          nextEnd = format(addDays(parseISO(session.end0), deltaDays), 'yyyy-MM-dd')
        }
        if (nextStart > nextEnd) {
          const t = nextStart
          nextStart = nextEnd
          nextEnd = t
        }
        const next = { bookingId: session.bookingId, startDate: nextStart, endDate: nextEnd }
        bookingLiveRef.current = next
        setBookingLive(next)
      }

      attachBookingDragEnd(onMove)
    },
    [onBookingDatesChange],
  )

  const onBookingCenterPointerDown = useCallback(
    (b: Booking, roomId: string, e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!onBookingEditClick && !onBookingDatesChange) return

      if (!onBookingDatesChange) {
        onBookingEditClick?.(b)
        return
      }
      if (!onBookingEditClick) {
        startBookingMove(b, roomId, e.clientX, e.clientY)
        return
      }

      const sx = e.clientX
      const sy = e.clientY
      let moved = false

      const onMove = (ev: PointerEvent) => {
        if (moved) return
        if (
          Math.abs(ev.clientX - sx) > BOOKING_CLICK_MAX_PX ||
          Math.abs(ev.clientY - sy) > BOOKING_CLICK_MAX_PX
        ) {
          moved = true
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          startBookingMove(b, roomId, sx, sy)
        }
      }

      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        if (!moved) onBookingEditClick(b)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish, { once: true })
      window.addEventListener('pointercancel', finish, { once: true })
    },
    [onBookingDatesChange, onBookingEditClick, startBookingMove],
  )

  const startResizeBookingStart = useCallback(
    (booking: Booking, roomId: string, clientX: number, _clientY: number) => {
      if (!onBookingDatesChange) return
      cancelNewBookingDragIfAny()

      bookingDragSessionRef.current = {
        kind: 'resize-start',
        bookingId: booking.id,
        roomId,
        start0: booking.startDate,
        endFixed: booking.endDate,
        startClientX: clientX,
      }
      const initial = {
        bookingId: booking.id,
        startDate: booking.startDate,
        endDate: booking.endDate,
      }
      bookingLiveRef.current = initial
      setBookingLive(initial)

      const onMove = (e: PointerEvent) => {
        const session = bookingDragSessionRef.current
        if (!session || session.kind !== 'resize-start') return
        let newStart = session.start0
        const hit = getCellDayAtPoint(e.clientX, e.clientY)
        if (hit && hit.roomId === session.roomId) {
          newStart = hit.dayKey
        } else {
          const deltaDays = Math.round(
            (e.clientX - session.startClientX) / dayColWidthRef.current,
          )
          newStart = format(addDays(parseISO(session.start0), deltaDays), 'yyyy-MM-dd')
        }
        if (newStart > session.endFixed) newStart = session.endFixed
        const next = { bookingId: session.bookingId, startDate: newStart, endDate: session.endFixed }
        bookingLiveRef.current = next
        setBookingLive(next)
      }

      attachBookingDragEnd(onMove)
    },
    [onBookingDatesChange],
  )

  const startResizeBookingEnd = useCallback(
    (booking: Booking, roomId: string, clientX: number, _clientY: number) => {
      if (!onBookingDatesChange) return
      cancelNewBookingDragIfAny()

      bookingDragSessionRef.current = {
        kind: 'resize-end',
        bookingId: booking.id,
        roomId,
        startFixed: booking.startDate,
        end0: booking.endDate,
        startClientX: clientX,
      }
      const initial = {
        bookingId: booking.id,
        startDate: booking.startDate,
        endDate: booking.endDate,
      }
      bookingLiveRef.current = initial
      setBookingLive(initial)

      const onMove = (e: PointerEvent) => {
        const session = bookingDragSessionRef.current
        if (!session || session.kind !== 'resize-end') return
        let newEnd = session.end0
        const hit = getCellDayAtPoint(e.clientX, e.clientY)
        if (hit && hit.roomId === session.roomId) {
          newEnd = hit.dayKey
        } else {
          const deltaDays = Math.round(
            (e.clientX - session.startClientX) / dayColWidthRef.current,
          )
          newEnd = format(addDays(parseISO(session.end0), deltaDays), 'yyyy-MM-dd')
        }
        if (newEnd < session.startFixed) newEnd = session.startFixed
        const next = { bookingId: session.bookingId, startDate: session.startFixed, endDate: newEnd }
        bookingLiveRef.current = next
        setBookingLive(next)
      }

      attachBookingDragEnd(onMove)
    },
    [onBookingDatesChange],
  )

  return (
    <div className="min-h-0 min-w-0 w-full flex-1 overflow-x-auto rounded-lg border border-border bg-background p-2 shadow-sm">
      <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3">
      {/* Панель навигации по датам */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={format(viewAnchor, 'yyyy-MM-dd')}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              setViewAnchor(parseISO(v))
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setViewAnchor(new Date())}
          >
            Сегодня
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2"
            onClick={() => setViewAnchor((d) => addMonths(d, -1))}
            aria-label="Предыдущий месяц"
          >
            ‹
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium capitalize">
            {format(viewMonth, 'LLLL yyyy', { locale: ru })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2"
            onClick={() => setViewAnchor((d) => addMonths(d, 1))}
            aria-label="Следующий месяц"
          >
            ›
          </Button>
        </div>
        <p className="text-sm text-muted-foreground capitalize">
          {format(addMonths(viewMonth, 1), 'LLLL yyyy', { locale: ru })}
        </p>
      </div>

      <div className="min-h-0 min-w-0 w-full flex-1 overflow-auto rounded-lg border border-border">
        <div ref={gridBodyRef} className="relative w-full min-w-0">
          {todayTimeLineLeftPx != null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 z-[25] w-px bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.75)]"
              style={{
                left: todayTimeLineLeftPx,
                transform: 'translateX(-50%)',
              }}
            />
          ) : null}
          {/* Липкий заголовок: числа и дни недели */}
          <div className="sticky top-0 z-20 border-b border-border bg-background shadow-sm">
            <div className="grid" style={{ gridTemplateColumns: gridCols }}>
              <div
                className="sticky left-0 z-30 flex items-center gap-1 border-r border-border bg-muted/95 px-2 py-2 text-xs font-medium"
                style={{ width: LABEL_COL_PX }}
              >
                <span>Категории номеров</span>
              </div>
              {days.map((d) => {
                const weekend = isSaturday(d) || isSunday(d)
                const padCol = !isSameMonth(d, viewMonth)
                return (
                  <div
                    key={dayKey(d)}
                    className={cn(
                      'border-r border-border py-1 text-center text-xs font-medium',
                      weekend && 'bg-sky-100/70 dark:bg-sky-950/40',
                      padCol && 'text-muted-foreground opacity-70',
                    )}
                  >
                    {format(d, 'd')}
                  </div>
                )
              })}
            </div>
            <div className="grid border-t border-border" style={{ gridTemplateColumns: gridCols }}>
              <div
                className="sticky left-0 z-30 border-r border-border bg-muted/95 px-2 py-1 text-[10px] text-muted-foreground"
                style={{ width: LABEL_COL_PX }}
              />
              {days.map((d) => {
                const weekend = isSaturday(d) || isSunday(d)
                const padCol = !isSameMonth(d, viewMonth)
                return (
                  <div
                    key={`w-${dayKey(d)}`}
                    className={cn(
                      'border-r border-border py-0.5 text-center text-[10px] text-muted-foreground',
                      weekend && 'bg-sky-100/70 dark:bg-sky-950/40',
                      padCol && 'opacity-60',
                    )}
                  >
                    {format(d, 'EEE', { locale: ru })}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Строки категорий и номеров */}
          {categories.map(({ category, rooms: catRooms }) => {
            const isCollapsed = collapsed.has(category)
            return (
              <div key={category}>
                {/* Строка категории: сводка по свободным местам */}
                <div
                  className="grid border-b border-border bg-muted/40"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div
                    className="sticky left-0 z-10 flex items-center gap-1 border-r border-border bg-muted/40 px-2 py-2 text-sm font-medium"
                    style={{ width: LABEL_COL_PX }}
                  >
                    <button
                      type="button"
                      className="inline-flex shrink-0 rounded p-0.5 hover:bg-muted"
                      onClick={() => toggleCategory(category)}
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <span className="truncate">{category}</span>
                  </div>
                  {days.map((d) => {
                    const k = dayKey(d)
                    const weekend = isSaturday(d) || isSunday(d)
                    const padCol = !isSameMonth(d, viewMonth)
                    const free = freeCountForCategory(catRooms, k, bookings)
                    return (
                      <div
                        key={k}
                        className={cn(
                          'flex items-center justify-center border-r border-border py-2 text-xs',
                          weekend && 'bg-sky-100/50 dark:bg-sky-950/30',
                          padCol && 'text-muted-foreground opacity-70',
                        )}
                      >
                        {free}
                      </div>
                    )
                  })}
                </div>

                {!isCollapsed ? (
                  <>
                    {catRooms.map((room, roomIdx) => {
                      const roomBookings = bookings.filter((b) => b.roomId === room.id)
                      const zebra = roomIdx % 2 === 0
                      const dirty = room.cleaningStatus === 'dirty'
                      const next = dirty ? findNextCheckInForRoom(room.id, bookings) : null
                      const urgent = next ? checkInUrgentWithinTwoHours(next.at) : false
                      const labelColTitle =
                        dirty && next
                          ? formatNextCheckInHoverTitle(next.at)
                          : dirty
                            ? `${room.name} · Нет предстоящего заезда по брони`
                            : room.name
                      const cleaningTooltipText =
                        dirty && next
                          ? `${roomCleaningToggleTitle(room.cleaningStatus)} · ${formatNextCheckInHoverTitle(next.at)}`
                          : dirty
                            ? `${roomCleaningToggleTitle(room.cleaningStatus)} · Нет предстоящего заезда по брони`
                            : roomCleaningToggleTitle(room.cleaningStatus)
                      return (
                        <div
                          key={room.id}
                          className={cn(
                            'relative grid border-b border-border',
                            zebra ? 'bg-background' : 'bg-muted/20',
                            urgent && 'z-[1] ring-2 ring-inset ring-amber-500',
                          )}
                          style={{
                            gridTemplateColumns: gridCols,
                            minHeight: 40,
                          }}
                        >
                          <div
                            className={cn(
                              'sticky left-0 z-10 flex items-center gap-1 border-r border-border px-2 py-1 text-sm',
                              zebra ? 'bg-background' : 'bg-muted/20',
                            )}
                            style={{ width: LABEL_COL_PX }}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="flex min-w-0 flex-1 cursor-default items-center gap-1 pl-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                                  tabIndex={0}
                                >
                                  {urgent ? (
                                    <span
                                      className="shrink-0 rounded-sm bg-amber-500 px-0.5 text-[9px] font-bold leading-none text-white dark:bg-amber-400 dark:text-amber-950"
                                      aria-hidden
                                    >
                                      !
                                    </span>
                                  ) : null}
                                  <span className="min-w-0 truncate">{room.name}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="right"
                                align="center"
                                sideOffset={10}
                                className="whitespace-normal"
                              >
                                {labelColTitle}
                              </TooltipContent>
                            </Tooltip>
                            {onRoomCleaningStatusClick ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0 self-center">
                                    <button
                                      type="button"
                                      disabled={roomCleaningSavingRoomId === room.id}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onRoomCleaningStatusClick(room.id)
                                      }}
                                      aria-label={`Уборка: ${room.name}. ${roomCleaningToggleTitle(room.cleaningStatus)}`}
                                      className={cn(
                                        'rounded-md p-1 transition-colors hover:bg-muted/80',
                                        roomCleaningSavingRoomId === room.id &&
                                          'pointer-events-none opacity-50',
                                      )}
                                    >
                                      {room.cleaningStatus === 'clean' ? (
                                        <Check
                                          className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                                          aria-hidden
                                        />
                                      ) : room.cleaningStatus === 'dirty' ? (
                                        <X className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
                                      ) : (
                                        <CircleDashed
                                          className="h-4 w-4 text-muted-foreground"
                                          aria-hidden
                                        />
                                      )}
                                    </button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="whitespace-normal">
                                  {cleaningTooltipText}
                                </TooltipContent>
                              </Tooltip>
                            ) : room.cleaningStatus === 'clean' ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0 self-center text-emerald-600 dark:text-emerald-400">
                                    <Check className="h-4 w-4" aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">Убрано</TooltipContent>
                              </Tooltip>
                            ) : room.cleaningStatus === 'dirty' ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0 self-center text-red-600 dark:text-red-400">
                                    <X className="h-4 w-4" aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="whitespace-normal">
                                  {next
                                    ? `Не убрано · ${formatNextCheckInHoverTitle(next.at)}`
                                    : 'Не убрано · Нет предстоящего заезда по брони'}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                          {days.map((d, dayIdx) => {
                            const weekend = isSaturday(d) || isSunday(d)
                            const padCol = !isSameMonth(d, viewMonth)
                            const closureWithSegment = (roomClosuresByRoomId.get(room.id) ?? [])
                              .map((item) => ({ item, segment: getClosureSegmentForDay(item, d) }))
                              .find((x) => x.segment !== null)
                            const closure = closureWithSegment?.item
                            const closureSegment = closureWithSegment?.segment ?? null
                            const inRange =
                              rangePreview &&
                              rangePreview.roomId === room.id &&
                              dayIdx >= Math.min(rangePreview.i0, rangePreview.i1) &&
                              dayIdx <= Math.max(rangePreview.i0, rangePreview.i1)
                            return (
                              <div
                                key={`${room.id}-${dayKey(d)}`}
                                data-shakh-day-cell
                                data-room-id={room.id}
                                data-day-index={dayIdx}
                                className={cn(
                                  'relative z-0 border-r border-border',
                                  weekend && (zebra ? 'bg-sky-100/30' : 'bg-sky-100/40'),
                                  padCol && 'bg-muted/35 opacity-80',
                                  onNewBookingRequest &&
                                    'touch-none select-none cursor-cell hover:bg-primary/5',
                                  inRange && 'bg-primary/20 ring-inset ring-1 ring-primary/35',
                                )}
                                onPointerDown={
                                  onNewBookingRequest
                                    ? (e) => beginCellDrag(room.id, dayIdx, e)
                                    : undefined
                                }
                                onPointerEnter={
                                  onNewBookingRequest
                                    ? () => handleCellPointerEnter(room.id, dayIdx)
                                    : undefined
                                }
                              >
                                {closureSegment ? (
                                  <div
                                    className="absolute inset-y-0 cursor-pointer bg-red-200/80 dark:bg-red-900/55"
                                    style={{
                                      left: `${closureSegment.startPercent}%`,
                                      width: `${Math.max(
                                        2,
                                        closureSegment.endPercent - closureSegment.startPercent,
                                      )}%`,
                                    }}
                                    title={
                                      closure
                                        ? [
                                            `Закрыто: ${closure.reason}`,
                                            `Период: ${format(parseISO(closure.startAt), 'dd.MM.yyyy HH:mm')} - ${format(parseISO(closure.endAt), 'dd.MM.yyyy HH:mm')}`,
                                            `Создал: ${closure.createdByName ?? 'неизвестно'}`,
                                          ].join('\n')
                                        : undefined
                                    }
                                    onPointerDown={(e) => {
                                      if (!closure) return
                                      e.preventDefault()
                                      e.stopPropagation()
                                      onRoomClosureClick?.(closure)
                                    }}
                                  />
                                ) : null}
                              </div>
                            )
                          })}
                          {/* Полосы броней */}
                          {roomBookings.map((b) => {
                            const display =
                              bookingLive?.bookingId === b.id
                                ? {
                                    ...b,
                                    startDate: bookingLive.startDate,
                                    endDate: bookingLive.endDate,
                                  }
                                : b
                            const clamped = clampBookingToGrid(display, gridStartKey, gridEndKey)
                            if (!clamped) return null
                            const i0 = dayIndex(clamped.start)
                            const i1 = dayIndex(clamped.end)
                            if (i0 < 0 || i1 < 0) return null
                            const { left, width: wPx } = bookingBarLayoutPx({
                              labelColPx: LABEL_COL_PX,
                              dayColPx: dayColWidthPx,
                              startDayIndex: i0,
                              endDayIndex: i1,
                              checkInTime: display.checkInTime,
                              checkOutTime: display.checkOutTime,
                            })
                            const inT = formatCheckInTimeShort(display.checkInTime)
                            const outT = formatCheckOutTimeShort(display.checkOutTime)
                            const timeShort =
                              inT && outT ? `${inT} → ${outT}` : inT || (outT ? `до ${outT}` : '')
                            const isPaid = display.paymentStatus === 'paid'
                            const titleStr = `${display.guestName} · ${display.startDate}${inT ? ` ${inT}` : ''} — ${display.endDate}${outT ? ` ${outT}` : ''} · ${isPaid ? 'Оплачен' : 'Не оплачен'}`
                            const hasStickyNote =
                              Boolean(display.guestId) &&
                              guestIdsWithStickyNotes?.has(display.guestId!) === true
                            /** Жёлтый — не оплачен, зелёный — оплачен */
                            const paymentBarStyle = isPaid
                              ? ({ backgroundColor: '#15803d', color: '#fff' } as const)
                              : ({ backgroundColor: '#facc15', color: '#422006' } as const)
                            const handleBg = isPaid ? 'bg-white/20 hover:bg-white/30' : 'bg-black/25 hover:bg-black/35'

                            if (!onBookingDatesChange) {
                              return (
                                <div
                                  key={b.id}
                                  className="pointer-events-none absolute top-1/2 z-[1] flex h-6 -translate-y-1/2 items-center overflow-hidden rounded px-1 text-[10px] font-medium shadow-sm"
                                  style={{ left, width: wPx, ...paymentBarStyle }}
                                  title={titleStr}
                                >
                                  {hasStickyNote ? (
                                    <span
                                      className={cn(
                                        'mr-0.5 shrink-0 rounded-sm px-0.5 text-[9px] font-bold leading-none shadow-sm',
                                        isPaid
                                          ? 'bg-amber-300 text-amber-950 ring-1 ring-white/40'
                                          : 'bg-white/90 text-amber-900 ring-1 ring-amber-800/40',
                                      )}
                                      title="Есть заметка"
                                    >
                                      !
                                    </span>
                                  ) : null}
                                  <span className="truncate">
                                    {display.guestName}
                                    {timeShort ? (
                                      <span className="text-[9px] opacity-90"> · {timeShort}</span>
                                    ) : null}
                                  </span>
                                </div>
                              )
                            }

                            return (
                              <div
                                key={b.id}
                                className="absolute top-1/2 z-[2] flex h-6 -translate-y-1/2 overflow-hidden rounded text-[10px] font-medium shadow-sm"
                                style={{ left, width: wPx, ...paymentBarStyle }}
                                title={titleStr}
                              >
                                <button
                                  type="button"
                                  aria-label="Изменить дату заезда"
                                  className={cn(
                                    'flex h-full min-h-0 w-3 max-w-[18px] shrink-0 cursor-ew-resize touch-manipulation items-stretch border-0 px-0',
                                    handleBg,
                                  )}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    startResizeBookingStart(b, room.id, e.clientX, e.clientY)
                                  }}
                                />
                                <div
                                  className={cn(
                                    'flex min-w-0 flex-1 items-center overflow-hidden px-0.5 touch-manipulation',
                                    onBookingEditClick
                                      ? 'cursor-pointer active:cursor-grabbing'
                                      : 'cursor-grab active:cursor-grabbing',
                                  )}
                                  onPointerDown={(e) => onBookingCenterPointerDown(b, room.id, e)}
                                >
                                  {hasStickyNote ? (
                                    <span
                                      className={cn(
                                        'mr-0.5 shrink-0 rounded-sm px-0.5 text-[9px] font-bold leading-none shadow-sm',
                                        isPaid
                                          ? 'bg-amber-300 text-amber-950 ring-1 ring-white/40'
                                          : 'bg-white/90 text-amber-900 ring-1 ring-amber-800/40',
                                      )}
                                      title="Есть заметка"
                                    >
                                      !
                                    </span>
                                  ) : null}
                                  <span className="min-w-0 truncate">
                                    {display.guestName}
                                    {timeShort ? (
                                      <span className="text-[9px] opacity-90"> · {timeShort}</span>
                                    ) : null}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  aria-label="Изменить дату выезда"
                                  className={cn(
                                    'flex h-full min-h-0 w-3 max-w-[18px] shrink-0 cursor-ew-resize touch-manipulation items-stretch border-0 px-0',
                                    handleBg,
                                  )}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    startResizeBookingEnd(b, room.id, e.clientX, e.clientY)
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      </section>
    </div>
  )
}
