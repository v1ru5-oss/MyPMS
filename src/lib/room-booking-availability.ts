import { parseISO } from 'date-fns'

import type { Booking } from '@/types/models'

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
