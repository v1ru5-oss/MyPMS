/**
 * Нормализация времени заезда: из БД (time) или input[type=time] в HH:mm.
 */
export function normalizeCheckInTime(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined
  const t = String(raw).trim()
  if (!t) return undefined
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return undefined
  let h = parseInt(m[1]!, 10)
  const min = parseInt(m[2]!, 10)
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return undefined
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Доля суток [0, 1) от начала дня до момента заезда (для смещения полосы на шахматке). */
export function checkInTimeToDayFraction(time?: string | null): number {
  const n = normalizeCheckInTime(time)
  if (!n) return 0
  const [hs, ms] = n.split(':')
  const h = parseInt(hs!, 10)
  const m = parseInt(ms!, 10)
  const totalMin = h * 60 + m
  return Math.min(1 - 1e-6, Math.max(0, totalMin / (24 * 60)))
}

/** Подпись для полосы брони / title; пусто, если с полуночи. */
export function formatCheckInTimeShort(time?: string | null): string {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00') return ''
  return n
}

/** Значение для input type="time" (пустая бронь без времени → 00:00). */
export function checkInTimeForTimeInput(time?: string | null): string {
  return normalizeCheckInTime(time) ?? '00:00'
}

/**
 * Доля суток на дате выезда, где заканчивается полоса.
 * По бизнес-правилу: если время выезда не указано, считаем выезд в 12:00.
 */
export function checkOutTimeToEndFraction(time?: string | null): number {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00') return 12 / 24
  const [hs, ms] = n.split(':')
  const h = parseInt(hs!, 10)
  const m = parseInt(ms!, 10)
  const totalMin = h * 60 + m
  const frac = totalMin / (24 * 60)
  return Math.min(1 - 1e-6, Math.max(0, frac))
}

/** Подпись времени выезда; без времени показываем 12:00 по умолчанию. */
export function formatCheckOutTimeShort(time?: string | null): string {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00') return '12:00'
  return n
}

/** Значение для input type="time" (без времени выезда → 12:00). */
export function checkOutTimeForTimeInput(time?: string | null): string {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00') return '12:00'
  return n
}

/** Строка для колонки time в Postgres; 12:00 и пусто — null (значение по умолчанию). */
export function checkOutTimeToDb(time?: string | null): string | null {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00' || n === '12:00') return null
  return `${n}:00`
}

/** Горизонтальная геометрия полосы брони на шахматке (фикс. ширина колонки дня). */
export function bookingBarLayoutPx(params: {
  labelColPx: number
  dayColPx: number
  startDayIndex: number
  endDayIndex: number
  checkInTime?: string | null
  checkOutTime?: string | null
}): { left: number; width: number } {
  const { labelColPx, dayColPx, startDayIndex: i0, endDayIndex: i1, checkInTime, checkOutTime } =
    params
  const fracIn = checkInTimeToDayFraction(checkInTime)
  const fracOut = checkOutTimeToEndFraction(checkOutTime)
  const left = labelColPx + (i0 + fracIn) * dayColPx
  const spanDays = i1 + fracOut - (i0 + fracIn)
  const width = Math.max(8, spanDays * dayColPx - 4)
  return { left, width }
}

/** Строка для колонки time в Postgres (HH:mm:ss). 00:00 и пусто — null (как «с полуночи»). */
export function checkInTimeToDb(time?: string | null): string | null {
  const n = normalizeCheckInTime(time)
  if (!n || n === '00:00') return null
  return `${n}:00`
}
