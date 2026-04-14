import { addDays, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatGuestFullName } from '@/lib/guest-name'
import {
  insertStickyNote,
  markStickyNoteCompleted,
  softDeleteStickyNoteFromHome,
  updateStickyNote,
} from '@/lib/pms-db'
import { stickyNotePreview, stickyNoteSurfaceStyle } from '@/lib/sticky-note-ui'
import { cn } from '@/lib/utils'
import type { Booking, BookingSubGuest, Guest, PublicUser, Room, StickyNote } from '@/types/models'

function groupRoomsByCategoryOrdered(rooms: Room[]): { category: string; rooms: Room[] }[] {
  const map = new Map<string, Room[]>()
  for (const room of rooms) {
    const c = room.category ?? 'Без категории'
    if (!map.has(c)) map.set(c, [])
    map.get(c)!.push(room)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([category, list]) => ({
      category,
      rooms: [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    }))
}

function deadlineLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  try {
    const d = parseISO(iso)
    return format(d, 'd MMM yyyy, HH:mm', { locale: ru })
  } catch {
    return null
  }
}

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)'
const MOBILE_SLOTS_PER_PAGE = 3
const DESKTOP_SLOTS_PER_PAGE = 6

type StickyRowCell = StickyNote | 'add' | 'empty'

/** Проживание пересекает [startKey, endKey]; уже выехавших не показываем. */
function guestActiveInDateWindow(guest: Guest, windowStartKey: string, windowEndKey: string): boolean {
  if (guest.checkedOutAt) return false
  return guest.startDate <= windowEndKey && guest.endDate >= windowStartKey
}

/** Гость в выбранном номере с проживанием, пересекающим [startKey, endKey] (yyyy-MM-dd). */
function guestInRoomForDateWindow(
  guest: Guest,
  roomId: string,
  windowStartKey: string,
  windowEndKey: string,
): boolean {
  if (guest.roomId !== roomId) return false
  return guestActiveInDateWindow(guest, windowStartKey, windowEndKey)
}

function bookingOverlapsDateWindow(
  booking: Booking,
  windowStartKey: string,
  windowEndKey: string,
): boolean {
  return booking.startDate <= windowEndKey && booking.endDate >= windowStartKey
}

function formatSubGuestLabel(sg: BookingSubGuest): string {
  const full = [sg.lastName, sg.firstName, sg.middleName?.trim()].filter(Boolean).join(' ')
  const base = full.trim() ? full : `Гость ${sg.position}`
  const child = sg.isChild ? ' (реб.)' : ''
  return `${base}${child}`
}

function stickyNoteGuestLine(
  note: StickyNote,
  guests: Guest[],
  bookingSubGuests: BookingSubGuest[],
): string | undefined {
  if (note.bookingSubGuestId) {
    const sg = bookingSubGuests.find((s) => s.id === note.bookingSubGuestId)
    if (sg) return formatSubGuestLabel(sg)
  }
  if (note.guestId) {
    const g = guests.find((x) => x.id === note.guestId)
    if (g) return formatGuestFullName(g)
  }
  return undefined
}

function parseGuestPick(
  pick: string,
  bookingSubGuests: BookingSubGuest[],
  bookings: Booking[],
): { guestId: string | null; bookingSubGuestId: string | null } {
  const t = pick.trim()
  if (!t) return { guestId: null, bookingSubGuestId: null }
  if (t.startsWith('g:')) {
    return { guestId: t.slice(2), bookingSubGuestId: null }
  }
  if (t.startsWith('s:')) {
    const sid = t.slice(2)
    const sg = bookingSubGuests.find((x) => x.id === sid)
    if (!sg) return { guestId: null, bookingSubGuestId: null }
    const bk = bookings.find((b) => b.id === sg.bookingId)
    return { guestId: bk?.guestId?.trim() || null, bookingSubGuestId: sid }
  }
  return { guestId: null, bookingSubGuestId: null }
}

type GuestPickOption = { value: string; label: string }

/** Подпись выбранного гостя/субгостя — как в списке опций (с суффиксом номера, если номер в форме не задан). */
function labelForGuestPickValue(
  pick: string,
  sortedGuests: Guest[],
  bookings: Booking[],
  bookingSubGuests: BookingSubGuest[],
  roomNameById: Map<string, string>,
  formRoomId: string,
): string {
  const t = pick.trim()
  if (!t) return ''
  const rid = formRoomId.trim()
  if (t.startsWith('g:')) {
    const g = sortedGuests.find((x) => x.id === t.slice(2))
    if (!g) return ''
    const name = formatGuestFullName(g)
    return rid ? name : `${name} · № ${roomNameById.get(g.roomId) ?? g.roomId}`
  }
  if (t.startsWith('s:')) {
    const sg = bookingSubGuests.find((x) => x.id === t.slice(2))
    if (!sg) return ''
    const bk = bookings.find((b) => b.id === sg.bookingId)
    const base = formatSubGuestLabel(sg)
    const roomId = bk?.roomId ?? ''
    return rid ? base : `${base} · № ${roomNameById.get(roomId) ?? roomId}`
  }
  return ''
}

function guestPickQueryNorm(s: string): string {
  return s.trim().toLowerCase()
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso?.trim()) return ''
  try {
    const d = parseISO(iso)
    return format(d, "yyyy-MM-dd'T'HH:mm")
  } catch {
    return ''
  }
}

type StickyNotesBoardProps = {
  notes: StickyNote[]
  setNotes: Dispatch<SetStateAction<StickyNote[]>>
  rooms: Room[]
  guests: Guest[]
  bookings: Booking[]
  /** Плоский список субгостей по всем броням (как на главной). */
  bookingSubGuests: BookingSubGuest[]
  currentUser: PublicUser
  loadError?: string
}

export function StickyNotesBoard({
  notes,
  setNotes,
  rooms,
  guests,
  bookings,
  bookingSubGuests,
  currentUser,
  loadError,
}: StickyNotesBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [carouselPage, setCarouselPage] = useState(0)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StickyNote | null>(null)
  const [formBody, setFormBody] = useState('')
  const [formRoomId, setFormRoomId] = useState('')
  /** Значение селекта: `g:<guests.id>` или `s:<booking_sub_guests.id>` */
  const [formGuestPick, setFormGuestPick] = useState('')
  /** Текст в поле поиска гостя (живой фильтр). */
  const [guestInput, setGuestInput] = useState('')
  const [guestComboOpen, setGuestComboOpen] = useState(false)
  const guestComboAnchorRef = useRef<HTMLDivElement>(null)
  const [guestListRect, setGuestListRect] = useState<{ top: number; left: number; width: number } | null>(null)
  /** Узел контента диалога: портал списка гостей должен быть внутри него, иначе модальный слой Radix блокирует клики. */
  const [dialogPortalEl, setDialogPortalEl] = useState<HTMLElement | null>(null)
  const [formDeadline, setFormDeadline] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const roomsByCat = useMemo(() => groupRoomsByCategoryOrdered(rooms), [rooms])
  const sortedGuests = useMemo(() => {
    return [...guests].sort((a, b) => {
      const c = a.lastName.localeCompare(b.lastName, 'ru')
      if (c !== 0) return c
      return a.firstName.localeCompare(b.firstName, 'ru')
    })
  }, [guests])

  const roomNameById = useMemo(() => new Map(rooms.map((r) => [r.id, r.name] as const)), [rooms])

  /** Карточки Guest + субгости по броням; при выбранном номере — только по этому номеру, иначе — все за окно дат. */
  const guestPickOptions = useMemo((): GuestPickOption[] => {
    const rid = formRoomId.trim()
    const windowStartKey = format(new Date(), 'yyyy-MM-dd')
    const windowEndKey = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const options: GuestPickOption[] = []
    const seen = new Set<string>()

    for (const g of sortedGuests) {
      const inWindow = rid
        ? guestInRoomForDateWindow(g, rid, windowStartKey, windowEndKey)
        : guestActiveInDateWindow(g, windowStartKey, windowEndKey)
      if (!inWindow) continue
      const value = `g:${g.id}`
      if (seen.has(value)) continue
      seen.add(value)
      const name = formatGuestFullName(g)
      const label = rid ? name : `${name} · № ${roomNameById.get(g.roomId) ?? g.roomId}`
      options.push({ value, label })
    }

    const bookingsInScope = rid
      ? bookings.filter(
          (b) => b.roomId === rid && bookingOverlapsDateWindow(b, windowStartKey, windowEndKey),
        )
      : bookings.filter((b) => bookingOverlapsDateWindow(b, windowStartKey, windowEndKey))

    for (const b of bookingsInScope) {
      const subs = bookingSubGuests
        .filter((s) => s.bookingId === b.id)
        .sort((a, c) => a.position - c.position)
      for (const sg of subs) {
        if (sg.position === 1 && b.guestId) continue
        const value = `s:${sg.id}`
        if (seen.has(value)) continue
        seen.add(value)
        const base = formatSubGuestLabel(sg)
        const label = rid ? base : `${base} · № ${roomNameById.get(b.roomId) ?? b.roomId}`
        options.push({ value, label })
      }
    }

    options.sort((a, b) => a.label.localeCompare(b.label, 'ru'))

    const pick = formGuestPick.trim()
    if (pick && !seen.has(pick)) {
      if (pick.startsWith('g:')) {
        const g = sortedGuests.find((x) => x.id === pick.slice(2))
        if (g) options.push({ value: pick, label: formatGuestFullName(g) })
      } else if (pick.startsWith('s:')) {
        const sg = bookingSubGuests.find((x) => x.id === pick.slice(2))
        if (sg) options.push({ value: pick, label: formatSubGuestLabel(sg) })
      }
    }

    return options
  }, [sortedGuests, bookings, bookingSubGuests, formRoomId, formGuestPick, roomNameById])

  const filteredGuestPickOptions = useMemo(() => {
    const q = guestPickQueryNorm(guestInput)
    if (!q) return guestPickOptions
    return guestPickOptions.filter((o) => guestPickQueryNorm(o.label).includes(q))
  }, [guestPickOptions, guestInput])

  const updateGuestListRect = useCallback(() => {
    if (!guestComboOpen || !guestComboAnchorRef.current) {
      setGuestListRect(null)
      return
    }
    const r = guestComboAnchorRef.current.getBoundingClientRect()
    setGuestListRect({ top: r.bottom + 6, left: r.left, width: r.width })
  }, [guestComboOpen])

  useLayoutEffect(() => {
    updateGuestListRect()
  }, [updateGuestListRect, guestInput, filteredGuestPickOptions.length, dialogOpen])

  useEffect(() => {
    if (!guestComboOpen) return
    const onResizeOrScroll = () => updateGuestListRect()
    window.addEventListener('resize', onResizeOrScroll)
    window.addEventListener('scroll', onResizeOrScroll, true)
    return () => {
      window.removeEventListener('resize', onResizeOrScroll)
      window.removeEventListener('scroll', onResizeOrScroll, true)
    }
  }, [guestComboOpen, updateGuestListRect])

  useEffect(() => {
    if (!dialogOpen) {
      setGuestComboOpen(false)
      setGuestListRect(null)
      setDialogPortalEl(null)
    }
  }, [dialogOpen])

  /** Только смена номера в форме меняет суффикс «· № …» у выбранного гостя. */
  useEffect(() => {
    if (!formGuestPick.trim()) return
    const next = labelForGuestPickValue(
      formGuestPick,
      sortedGuests,
      bookings,
      bookingSubGuests,
      roomNameById,
      formRoomId,
    )
    if (next) setGuestInput(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только номер; иначе перетирается ввод при обновлении списков
  }, [formRoomId])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const sync = (mobile: boolean) => setIsMobile(mobile)
    sync(media.matches)
    const onChange = (event: MediaQueryListEvent) => sync(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const slotsPerPage = isMobile ? MOBILE_SLOTS_PER_PAGE : DESKTOP_SLOTS_PER_PAGE
  const slots = useMemo<(StickyNote | 'add')[]>(() => [...notes, 'add'], [notes])
  const totalPages = Math.max(1, Math.ceil(slots.length / slotsPerPage))

  useEffect(() => {
    setCarouselPage((p) => Math.min(Math.max(0, p), totalPages - 1))
  }, [totalPages])

  const showCarouselNav = slots.length > slotsPerPage
  const pageStart = carouselPage * slotsPerPage
  const rowCells = useMemo<StickyRowCell[]>(() => {
    const slice = slots.slice(pageStart, pageStart + slotsPerPage)
    const out: StickyRowCell[] = [...slice]
    while (out.length < slotsPerPage) out.push('empty')
    return out
  }, [slots, pageStart, slotsPerPage])

  function openNew() {
    setEditing(null)
    setFormBody('')
    setFormRoomId('')
    setFormGuestPick('')
    setGuestInput('')
    setGuestComboOpen(false)
    setFormDeadline('')
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(note: StickyNote) {
    setEditing(note)
    setFormBody(note.body)
    let roomId = note.roomId?.trim() || ''
    if (!roomId && note.bookingSubGuestId) {
      const sg = bookingSubGuests.find((s) => s.id === note.bookingSubGuestId)
      const bk = sg ? bookings.find((b) => b.id === sg.bookingId) : undefined
      roomId = bk?.roomId ?? ''
    }
    if (!roomId) {
      const guestFromNote = note.guestId ? guests.find((g) => g.id === note.guestId) : undefined
      roomId = guestFromNote?.roomId ?? ''
    }
    setFormRoomId(roomId)
    let pickStr = ''
    if (note.bookingSubGuestId) {
      pickStr = `s:${note.bookingSubGuestId}`
      setFormGuestPick(pickStr)
    } else if (note.guestId) {
      pickStr = `g:${note.guestId}`
      setFormGuestPick(pickStr)
    } else {
      setFormGuestPick('')
    }
    setGuestInput(
      pickStr
        ? labelForGuestPickValue(pickStr, sortedGuests, bookings, bookingSubGuests, roomNameById, roomId)
        : '',
    )
    setGuestComboOpen(false)
    setFormDeadline(toDatetimeLocalValue(note.deadlineAt))
    setFormError('')
    setDialogOpen(true)
  }

  async function handleSave() {
    const body = formBody.trim()
    if (!body) {
      setFormError('Введите текст заметки.')
      return
    }
    setFormError('')
    setSaving(true)
    const deadlineIso =
      formDeadline.trim() === ''
        ? null
        : (() => {
            const d = new Date(formDeadline)
            return Number.isNaN(d.getTime()) ? null : d.toISOString()
          })()
    let roomId = formRoomId.trim() || null
    const { guestId, bookingSubGuestId } = parseGuestPick(formGuestPick, bookingSubGuests, bookings)
    if (guestId || bookingSubGuestId) {
      if (bookingSubGuestId) {
        const sg = bookingSubGuests.find((x) => x.id === bookingSubGuestId)
        if (!sg) {
          setFormError('Проживающий не найден в списке.')
          setSaving(false)
          return
        }
        const bk = bookings.find((b) => b.id === sg.bookingId)
        if (roomId && bk && bk.roomId !== roomId) {
          setFormError('Выбранный проживающий относится к другому номеру.')
          setSaving(false)
          return
        }
        if (!roomId && bk) roomId = bk.roomId
      }
      if (guestId) {
        const g = guests.find((x) => x.id === guestId)
        if (!g) {
          setFormError('Гость не найден в списке.')
          setSaving(false)
          return
        }
        if (roomId && g.roomId !== roomId) {
          setFormError('Выбранный гость относится к другому номеру. Укажите тот же номер, что в карточке гостя.')
          setSaving(false)
          return
        }
        if (!roomId) roomId = g.roomId
      }
    }
    try {
      if (editing) {
        const updated = await updateStickyNote(editing.id, {
          body,
          roomId,
          guestId,
          bookingSubGuestId,
          deadlineAt: deadlineIso,
        })
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
      } else {
        const created = await insertStickyNote({
          body,
          roomId,
          guestId,
          bookingSubGuestId,
          deadlineAt: deadlineIso,
          createdByUserId: currentUser.id,
          createdByName: currentUser.username,
        })
        setNotes((prev) => [...prev, created].sort((a, b) => {
          const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.POSITIVE_INFINITY
          const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.POSITIVE_INFINITY
          if (da !== db) return da - db
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        }))
      }
      setDialogOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось сохранить.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    setSaving(true)
    setFormError('')
    try {
      await softDeleteStickyNoteFromHome(editing.id, {
        userId: currentUser.id,
        userName: currentUser.username,
      })
      setNotes((prev) => prev.filter((n) => n.id !== editing.id))
      setDialogOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось удалить.')
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    if (!editing) return
    setSaving(true)
    setFormError('')
    try {
      await markStickyNoteCompleted(editing.id, {
        userId: currentUser.id,
        userName: currentUser.username,
      })
      setNotes((prev) => prev.filter((n) => n.id !== editing.id))
      setDialogOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось отметить заметку как выполненную.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mb-4 min-w-0" aria-label="Заметки">
      <h2 className="mb-2 text-lg font-semibold tracking-tight">Заметки</h2>

      {loadError ? (
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : null}

      <div className={cn('flex min-w-0 items-stretch gap-1', showCarouselNav && 'pb-1')}>
        {showCarouselNav ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-[8rem] w-9 shrink-0 self-stretch px-0"
            disabled={carouselPage <= 0}
            aria-label="Предыдущие заметки"
            onClick={() => setCarouselPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
        <div
          ref={viewportRef}
          className={cn(
            'grid h-[8rem] min-h-0 min-w-0 flex-1 gap-3 overflow-hidden',
            isMobile ? 'grid-cols-3' : 'grid-cols-6',
          )}
        >
          {rowCells.map((item, cellIdx) => {
            if (item === 'empty') {
              return (
                <div
                  key={`empty-${carouselPage}-${cellIdx}`}
                  className="h-full min-h-0 min-w-0 rounded-sm border border-dashed border-muted-foreground/20 bg-muted/10 dark:border-muted-foreground/25 dark:bg-muted/20"
                  aria-hidden
                />
              )
            }
            if (item === 'add') {
              return (
                <button
                  key={`add-${carouselPage}`}
                  type="button"
                  onClick={openNew}
                  className="flex max-h-full min-h-0 min-w-0 flex-col items-center justify-center rounded-sm border-2 border-dashed border-amber-400/50 bg-muted/20 text-xs text-muted-foreground transition-colors hover:border-amber-500/70 hover:bg-muted/40 dark:border-amber-700/40"
                >
                  + заметка
                </button>
              )
            }
            const note = item
            const guestLine = stickyNoteGuestLine(note, guests, bookingSubGuests)
            const guest = note.guestId ? guests.find((g) => g.id === note.guestId) : undefined
            const roomIdForDisplay =
              note.roomId?.trim() ||
              guest?.roomId ||
              (note.bookingSubGuestId
                ? (() => {
                    const sg = bookingSubGuests.find((s) => s.id === note.bookingSubGuestId)
                    const bk = sg ? bookings.find((b) => b.id === sg.bookingId) : undefined
                    return bk?.roomId
                  })()
                : undefined)
            const room = roomIdForDisplay ? rooms.find((r) => r.id === roomIdForDisplay) : undefined
            const dl = deadlineLabel(note.deadlineAt)
            const surface = stickyNoteSurfaceStyle(note.deadlineAt)
            const author = note.createdByName?.trim() || 'Не указан'
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => openEdit(note)}
                className={cn(
                  'sticky-note sticky-note-type flex max-h-full min-h-0 min-w-0 flex-col rounded-sm p-2.5 text-left text-[13px] leading-snug transition-transform hover:z-10 hover:scale-[1.02] active:scale-[0.99]',
                )}
                style={surface}
              >
                <p className="line-clamp-2 min-h-0 flex-1 whitespace-pre-wrap break-words">
                  {stickyNotePreview(note.body)}
                </p>
                {(room || guestLine || dl) && (
                  <div className="sticky-note-type-meta mt-2 shrink-0 border-t pt-1.5 text-[10px]">
                    {room ? <p className="truncate">№ {room.name}</p> : null}
                    {guestLine ? <p className="truncate">{guestLine}</p> : null}
                    {dl ? <p className="tabular-nums">до {dl}</p> : null}
                    <p className="truncate">автор: {author}</p>
                  </div>
                )}
              </button>
            )
          })}
        </div>
        {showCarouselNav ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-[8rem] w-9 shrink-0 self-stretch px-0"
            disabled={carouselPage >= totalPages - 1}
            aria-label="Следующие заметки"
            onClick={() => setCarouselPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent ref={setDialogPortalEl}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Заметка' : 'Новая заметка'}</DialogTitle>
            <DialogDescription>
              Текст виден целиком здесь. На главной — только начало. Дедлайн окрашивает стикер (ближе к сроку —
              заметнее).
            </DialogDescription>
            <p className="text-xs text-muted-foreground">
              Автор:{' '}
              <span className="font-medium text-foreground">
                {editing?.createdByName?.trim() || currentUser.username}
              </span>
            </p>
          </DialogHeader>

          <div className="grid max-h-[min(70vh,32rem)] gap-4 overflow-y-auto py-1 pr-1">
            <div className="grid gap-2">
              <Label htmlFor="sticky-body">Текст</Label>
              <textarea
                id="sticky-body"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={6}
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/80 focus-visible:border-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                placeholder="Напоминание, задача…"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-2">
                <Label htmlFor="sticky-room">Номер (необязательно)</Label>
                <select
                  id="sticky-room"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={formRoomId}
                  onChange={(e) => {
                    const next = e.target.value
                    setFormRoomId(next)
                    const pick = formGuestPick.trim()
                    if (!pick) return
                    const { guestId: gid, bookingSubGuestId: sid } = parseGuestPick(
                      pick,
                      bookingSubGuests,
                      bookings,
                    )
                    if (sid) {
                      const sg = bookingSubGuests.find((x) => x.id === sid)
                      const bk = sg ? bookings.find((b) => b.id === sg.bookingId) : undefined
                      if (bk && bk.roomId !== next) {
                        setFormGuestPick('')
                        setGuestInput('')
                      }
                      return
                    }
                    if (gid) {
                      const g = guests.find((x) => x.id === gid)
                      if (!g || g.roomId !== next) {
                        setFormGuestPick('')
                        setGuestInput('')
                      }
                    }
                  }}
                >
                  <option value="">—</option>
                  {roomsByCat.map(({ category, rooms: rs }) => (
                    <optgroup key={category} label={category}>
                      {rs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sticky-guest">Гость (необязательно)</Label>
                <div ref={guestComboAnchorRef} className="relative">
                  <Input
                    id="sticky-guest"
                    value={guestInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setGuestInput(v)
                      setGuestComboOpen(true)
                      const cur = guestPickOptions.find((o) => o.value === formGuestPick)
                      if (!cur || cur.label !== v) {
                        if (formGuestPick) setFormGuestPick('')
                      }
                    }}
                    onFocus={() => setGuestComboOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setGuestComboOpen(false), 120)
                    }}
                    placeholder="Начните вводить фамилию или имя…"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={guestComboOpen}
                    aria-controls="sticky-guest-listbox"
                    aria-autocomplete="list"
                  />
                  {guestComboOpen && guestListRect && dialogPortalEl
                    ? createPortal(
                        <ul
                          id="sticky-guest-listbox"
                          role="listbox"
                          style={{
                            position: 'fixed',
                            top: guestListRect.top,
                            left: guestListRect.left,
                            width: guestListRect.width,
                            zIndex: 200,
                          }}
                          className="pointer-events-auto max-h-48 overflow-y-auto rounded-md border border-border bg-background py-1 text-sm shadow-md"
                        >
                          {filteredGuestPickOptions.length === 0 ? (
                            <li className="px-3 py-2 text-muted-foreground">Никого не найдено</li>
                          ) : (
                            filteredGuestPickOptions.map((opt) => (
                              <li key={opt.value} role="option">
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 text-left hover:bg-muted/80 focus:bg-muted/80 focus:outline-none"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    setFormGuestPick(opt.value)
                                    setGuestInput(opt.label)
                                    setGuestComboOpen(false)
                                  }}
                                >
                                  {opt.label}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>,
                        dialogPortalEl,
                      )
                    : null}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sticky-deadline">Дедлайн (необязательно)</Label>
              <Input
                id="sticky-deadline"
                type="datetime-local"
                value={formDeadline}
                onChange={(e) => setFormDeadline(e.target.value)}
              />
            </div>
            {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    disabled={saving}
                    onClick={() => void handleComplete()}
                  >
                    Выполнено
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    disabled={saving}
                    onClick={() => void handleDelete()}
                  >
                    Удалить
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="button" disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
