import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

import { normalizeCheckInTime } from '@/lib/booking-check-in-time'
import type { Booking } from '@/types/models'

const TWO_H_MS = 2 * 60 * 60 * 1000

/** Локальные дата-время заезда по брони (startDate + checkInTime; без времени — 00:00). */
export function bookingCheckInLocalDate(booking: Booking): Date {
  const parts = booking.startDate.split('-').map((x) => parseInt(x, 10))
  const y = parts[0]!
  const mo = parts[1]!
  const d = parts[2]!
  const t = normalizeCheckInTime(booking.checkInTime) ?? '00:00'
  const [hs, ms] = t.split(':')
  const hh = parseInt(hs!, 10)
  const mm = parseInt(ms!, 10)
  return new Date(y, mo - 1, d, hh, mm, 0, 0)
}

/** Ближайший заезд по брони в номере, у которого момент заезда ещё не прошёл (относительно now). */
export function findNextCheckInForRoom(
  roomId: string,
  bookings: Booking[],
  now = new Date(),
): { at: Date; booking: Booking } | null {
  const ts = now.getTime()
  let best: { at: Date; booking: Booking } | null = null
  for (const b of bookings) {
    if (b.roomId !== roomId) continue
    let at: Date
    try {
      at = bookingCheckInLocalDate(b)
    } catch {
      continue
    }
    if (Number.isNaN(at.getTime())) continue
    if (at.getTime() < ts) continue
    if (!best || at.getTime() < best.at.getTime()) {
      best = { at, booking: b }
    }
  }
  return best
}

/** До заезда осталось от 0 до 2 часов (строго в будущем). */
export function checkInUrgentWithinTwoHours(checkInAt: Date, now = new Date()): boolean {
  const diff = checkInAt.getTime() - now.getTime()
  return diff > 0 && diff <= TWO_H_MS
}

/** Краткая подпись даты/времени заезда для карточки. */
export function formatNextCheckInShort(at: Date): string {
  return format(at, 'd MMM, HH:mm', { locale: ru })
}

/** Текст для подсказки: сколько осталось до заезда. */
export function formatCountdownToCheckInRu(at: Date, now = new Date()): string {
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return 'Время заезда наступило'
  const totalMin = Math.ceil(ms / 60_000)
  if (totalMin >= 24 * 60) {
    const d = Math.floor(totalMin / (24 * 60))
    const rem = totalMin % (24 * 60)
    const h = Math.floor(rem / 60)
    const m = rem % 60
    let s = `через ${d} дн.`
    if (h) s += ` ${h} ч`
    if (m) s += ` ${m} мин`
    return s.trim()
  }
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return m ? `через ${h} ч ${m} мин` : `через ${h} ч`
  }
  return `через ${totalMin} мин`
}

/** Полная подсказка при наведении. */
export function formatNextCheckInHoverTitle(at: Date, now = new Date()): string {
  const when = format(at, 'd MMMM yyyy, HH:mm', { locale: ru })
  return `Ближайший заезд: ${when}. ${formatCountdownToCheckInRu(at, now)}`
}
