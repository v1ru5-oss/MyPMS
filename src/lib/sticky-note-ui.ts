import type { CSSProperties } from 'react'

const YELLOW_GRADIENT =
  'linear-gradient(148deg, hsl(51 97% 88%) 0%, hsl(45 93% 76%) 55%, hsl(43 90% 72%) 100%)'

/** Фон стикера: жёлтый; ближе к дедлайну (и после) — смещение к красному. */
export function stickyNoteSurfaceStyle(deadlineAt: string | null | undefined): CSSProperties {
  if (!deadlineAt?.trim()) {
    return { backgroundImage: YELLOW_GRADIENT }
  }
  const t = new Date(deadlineAt).getTime()
  if (Number.isNaN(t)) {
    return { backgroundImage: YELLOW_GRADIENT }
  }
  const now = Date.now()
  const daysLeft = (t - now) / 86_400_000
  let urgency = 0
  if (daysLeft < 0) urgency = 1
  else if (daysLeft < 14) urgency = 1 - daysLeft / 14

  urgency = Math.min(1, Math.max(0, urgency))
  if (urgency < 0.03) {
    return { backgroundImage: YELLOW_GRADIENT }
  }

  const h = 52 * (1 - urgency) + 4 * urgency
  const s = 88 + 10 * urgency
  const l = 82 - 30 * urgency
  const h2 = 38 * (1 - urgency) + 0 * urgency
  const l2 = 72 - 34 * urgency
  return {
    backgroundImage: `linear-gradient(148deg, hsl(${h} ${s}% ${l}%) 0%, hsl(${h2} ${Math.min(96, s + 8)}% ${l2}%) 100%)`,
  }
}

/** Короткий превью-текст на стикере (полный текст в попапе). */
export function stickyNotePreview(body: string, maxLen = 72): string {
  const t = body.trim()
  if (!t) return ''
  const nl = t.indexOf('\n')
  const chunk = nl >= 0 ? t.slice(0, nl) : t
  if (chunk.length <= maxLen) return chunk
  return `${chunk.slice(0, Math.max(0, maxLen - 1))}…`
}
