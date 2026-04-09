/**
 * Разбор строки брони «Фамилия Имя Отчество» (порядок как в карточке гостя).
 * Одно слово → фамилия; два — фамилия + имя; три и более — фамилия, имя, остальное отчество.
 */
export function parseGuestNameFromLabel(label: string): {
  firstName: string
  lastName: string
  middleName: string
} {
  const t = label.trim()
  if (!t) return { firstName: '', lastName: '', middleName: '' }
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '', middleName: '' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0]!, middleName: '' }
  if (parts.length === 2) return { firstName: parts[1]!, lastName: parts[0]!, middleName: '' }
  return {
    lastName: parts[0]!,
    firstName: parts[1]!,
    middleName: parts.slice(2).join(' '),
  }
}

/** То же, что parseGuestNameFromLabel (совместимость со старым кодом). */
export function splitBookingGuestName(label: string): {
  firstName: string
  lastName: string
  middleName: string
} {
  return parseGuestNameFromLabel(label)
}

/** Строка для guest_name в брони и отображения на шахматке. */
export function buildGuestDisplayName(
  lastName: string,
  firstName: string,
  middleName?: string | null,
): string {
  return [lastName, firstName, (middleName ?? '').trim()]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' ')
}

export function formatGuestFullName(g: {
  lastName: string
  firstName: string
  middleName?: string | null
}): string {
  return buildGuestDisplayName(g.lastName, g.firstName, g.middleName)
}
