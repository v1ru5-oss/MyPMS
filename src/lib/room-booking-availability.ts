import { parseISO } from 'date-fns'

import type { Booking, RoomClosure } from '@/types/models'

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number.parseInt(m[1]!, 10)
  const min = Number.parseInt(m[2]!, 10)
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function buildRangeDateTime(
  dateStr: string,
  time: string | null | undefined,
  mode: 'start' | 'end',
): Date {
  const date = parseISO(dateStr)
  if (Number.isNaN(date.getTime())) return date
  const minutes = parseTimeToMinutes(time)
  // Для выезда 00:00 или пустого времени считаем 12:00 по бизнес-правилу.
  const totalMinutes = mode === 'end' ? (minutes == null || minutes === 0 ? 12 * 60 : minutes) : (minutes ?? 0)
  const result = new Date(date)
  result.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0)
  return result
}

/** Номер свобод на интервал [startDate, endDate], если нет другой брони на эту комнату с пересечением. */
export function isRoomFreeForBookingRange(
  roomId: string,
  startDateStr: string,
  endDateStr: string,
  bookings: Booking[],
  excludeBookingId?: string,
): boolean {
  const start = parseISO(startDateStr)
  const end = parseISO(endDateStr)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return true
  }
  return !bookings.some((booking) => {
    if (booking.roomId !== roomId) return false
    if (excludeBookingId && booking.id === excludeBookingId) return false
    const es = parseISO(booking.startDate)
    const ee = parseISO(booking.endDate)
    return start <= ee && end >= es
  })
}

export function doesRoomClosureOverlapRange(
  roomId: string,
  startDateStr: string,
  endDateStr: string,
  closures: RoomClosure[],
  startTime?: string | null,
  endTime?: string | null,
): boolean {
  const start = buildRangeDateTime(startDateStr, startTime, 'start')
  const end = buildRangeDateTime(endDateStr, endTime, 'end')
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return false
  }
  return closures.some((closure) => {
    if (closure.roomId !== roomId) return false
    const cs = parseISO(closure.startAt)
    const ce = parseISO(closure.endAt)
    if (Number.isNaN(cs.getTime()) || Number.isNaN(ce.getTime())) return false
    return start <= ce && end >= cs
  })
}
