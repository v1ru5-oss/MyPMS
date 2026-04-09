import { addDays, format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

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
import { deleteStickyNote, insertStickyNote, updateStickyNote } from '@/lib/pms-db'
import { stickyNotePreview, stickyNoteSurfaceStyle } from '@/lib/sticky-note-ui'
import { cn } from '@/lib/utils'
import type { Guest, Room, StickyNote } from '@/types/models'

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

/** Гость в выбранном номере с проживанием, пересекающим [startKey, endKey] (yyyy-MM-dd); уже выехавших не показываем. */
function guestInRoomForDateWindow(
  guest: Guest,
  roomId: string,
  windowStartKey: string,
  windowEndKey: string,
): boolean {
  if (guest.roomId !== roomId) return false
  if (guest.checkedOutAt) return false
  return guest.startDate <= windowEndKey && guest.endDate >= windowStartKey
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
  loadError?: string
}

export function StickyNotesBoard({ notes, setNotes, rooms, guests, loadError }: StickyNotesBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [carouselPage, setCarouselPage] = useState(0)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StickyNote | null>(null)
  const [formBody, setFormBody] = useState('')
  const [formRoomId, setFormRoomId] = useState('')
  const [formGuestId, setFormGuestId] = useState('')
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

  /** Гости в номере с проживанием в окне сегодня…сегодня+7 дней; плюс текущий выбор при редактировании (если уже не в окне). */
  const guestsForSelectedRoom = useMemo(() => {
    const rid = formRoomId.trim()
    if (!rid) return []
    const windowStartKey = format(new Date(), 'yyyy-MM-dd')
    const windowEndKey = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const inRoom = sortedGuests.filter((g) => guestInRoomForDateWindow(g, rid, windowStartKey, windowEndKey))
    const selectedId = formGuestId.trim()
    if (!selectedId) return inRoom
    const selected = sortedGuests.find((g) => g.id === selectedId)
    if (!selected || inRoom.some((g) => g.id === selectedId)) return inRoom
    return [...inRoom, selected].sort((a, b) => {
      const c = a.lastName.localeCompare(b.lastName, 'ru')
      if (c !== 0) return c
      return a.firstName.localeCompare(b.firstName, 'ru')
    })
  }, [sortedGuests, formRoomId, formGuestId])

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
    setFormGuestId('')
    setFormDeadline('')
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(note: StickyNote) {
    setEditing(note)
    setFormBody(note.body)
    const guestFromNote = note.guestId ? guests.find((g) => g.id === note.guestId) : undefined
    const roomId =
      note.roomId?.trim() ||
      (guestFromNote?.roomId ?? '')
    setFormRoomId(roomId)
    setFormGuestId(note.guestId ?? '')
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
    const guestId = formGuestId.trim() || null
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
    try {
      if (editing) {
        const updated = await updateStickyNote(editing.id, {
          body,
          roomId,
          guestId,
          deadlineAt: deadlineIso,
        })
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
      } else {
        const created = await insertStickyNote({
          body,
          roomId,
          guestId,
          deadlineAt: deadlineIso,
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
      await deleteStickyNote(editing.id)
      setNotes((prev) => prev.filter((n) => n.id !== editing.id))
      setDialogOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось удалить.')
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
            const guest = note.guestId ? guests.find((g) => g.id === note.guestId) : undefined
            const roomIdForDisplay = note.roomId ?? guest?.roomId
            const room = roomIdForDisplay ? rooms.find((r) => r.id === roomIdForDisplay) : undefined
            const dl = deadlineLabel(note.deadlineAt)
            const surface = stickyNoteSurfaceStyle(note.deadlineAt)
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
                {(room || guest || dl) && (
                  <div className="sticky-note-type-meta mt-2 shrink-0 border-t pt-1.5 text-[10px]">
                    {room ? <p className="truncate">№ {room.name}</p> : null}
                    {guest ? <p className="truncate">{formatGuestFullName(guest)}</p> : null}
                    {dl ? <p className="tabular-nums">до {dl}</p> : null}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Заметка' : 'Новая заметка'}</DialogTitle>
            <DialogDescription>
              Текст виден целиком здесь. На главной — только начало. Дедлайн окрашивает стикер (ближе к сроку —
              заметнее).
            </DialogDescription>
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
                    const gid = formGuestId.trim()
                    if (!gid) return
                    const g = guests.find((x) => x.id === gid)
                    if (!g || g.roomId !== next) setFormGuestId('')
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
                <Label htmlFor="sticky-guest">Гость в этом номере (необязательно)</Label>
                <select
                  id="sticky-guest"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={formGuestId}
                  disabled={!formRoomId.trim()}
                  onChange={(e) => setFormGuestId(e.target.value)}
                >
                  <option value="">
                    {formRoomId.trim() ? '—' : 'Сначала выберите номер'}
                  </option>
                  {guestsForSelectedRoom.map((g) => (
                    <option key={g.id} value={g.id}>
                      {formatGuestFullName(g)}
                    </option>
                  ))}
                </select>
                {formRoomId.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    Только гости с проживанием в этом номере в период с сегодняшнего дня по +7 дней (даты заезда/выезда в
                    карточке).
                  </p>
                ) : null}
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
            <div>
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                >
                  Удалить
                </Button>
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
