import { addDays, format, isValid, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser } from '@/lib/access'
import { formatGuestFullName } from '@/lib/guest-name'
import {
  fetchCompletedStickyNotes,
  fetchGuests,
  fetchPendingDeletionStickyNotes,
  fetchRooms,
  fetchStickyNotes,
  insertStickyNote,
  markStickyNoteCompleted,
  purgeStickyNote,
  softDeleteStickyNoteFromHome,
  subscribeNotesRealtime,
  updateStickyNoteBody,
} from '@/lib/pms-db'
import type { Guest, Room, StickyNote } from '@/types/models'

function formatNoteDateTime(iso: string | null | undefined, empty = '—'): string {
  if (!iso?.trim()) return empty
  try {
    const d = parseISO(iso)
    if (!isValid(d)) return empty
    return format(d, 'dd.MM.yyyy, HH:mm', { locale: ru })
  } catch {
    return empty
  }
}

function noteBodyPreview(body: string, maxLen = 72): string {
  const t = body.trim()
  if (!t) return '—'
  const nl = t.indexOf('\n')
  const chunk = nl >= 0 ? t.slice(0, nl) : t
  if (chunk.length <= maxLen) return chunk
  return `${chunk.slice(0, Math.max(0, maxLen - 1))}…`
}

function resolveRoomGuest(
  note: StickyNote,
  roomById: Map<string, Room>,
  guestById: Map<string, Guest>,
): { room: Room | undefined; guest: Guest | undefined } {
  const guest = note.guestId ? guestById.get(note.guestId) : undefined
  const roomIdForDisplay = note.roomId ?? guest?.roomId
  const room = roomIdForDisplay ? roomById.get(roomIdForDisplay) : undefined
  return { room, guest }
}

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

/** Гость в номере с проживанием, пересекающим [startKey, endKey]; выехавших не показываем. */
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

async function loadNotesData(): Promise<{
  active: StickyNote[]
  completed: StickyNote[]
  pendingDeletion: StickyNote[]
}> {
  const [active, completed, pendingDeletion] = await Promise.all([
    fetchStickyNotes(),
    fetchCompletedStickyNotes(),
    fetchPendingDeletionStickyNotes(),
  ])
  return { active, completed, pendingDeletion }
}

export default function NotesPage() {
  const { user } = useAuth()
  const showPurgeButton = user ? isAdminUser(user) : false

  const [activeNotes, setActiveNotes] = useState<StickyNote[]>([])
  const [completedNotes, setCompletedNotes] = useState<StickyNote[]>([])
  const [pendingDeletionNotes, setPendingDeletionNotes] = useState<StickyNote[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loadError, setLoadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [detailNoteId, setDetailNoteId] = useState<string | null>(null)
  const [activeDialogBusy, setActiveDialogBusy] = useState(false)
  const [activeDialogAction, setActiveDialogAction] = useState<'complete' | 'delete' | null>(null)
  const [activeDialogError, setActiveDialogError] = useState('')
  const [editBody, setEditBody] = useState('')
  const [bodySaveBusy, setBodySaveBusy] = useState(false)
  const [bodySaveError, setBodySaveError] = useState('')
  const [completedSectionOpen, setCompletedSectionOpen] = useState(false)
  const [pendingSectionOpen, setPendingSectionOpen] = useState(false)
  const [newNoteOpen, setNewNoteOpen] = useState(false)
  const [newFormBody, setNewFormBody] = useState('')
  const [newFormRoomId, setNewFormRoomId] = useState('')
  const [newFormGuestId, setNewFormGuestId] = useState('')
  const [newFormDeadline, setNewFormDeadline] = useState('')
  const [newFormSaving, setNewFormSaving] = useState(false)
  const [newFormError, setNewFormError] = useState('')

  useEffect(() => {
    setActiveDialogError('')
    setActiveDialogAction(null)
    setBodySaveError('')
  }, [detailNoteId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadError('')
      try {
        const [{ active, completed, pendingDeletion }, roomsList, guestsList] = await Promise.all([
          loadNotesData(),
          fetchRooms(),
          fetchGuests(),
        ])
        if (cancelled) return
        setActiveNotes(active)
        setCompletedNotes(completed)
        setPendingDeletionNotes(pendingDeletion)
        setRooms(roomsList)
        setGuests(guestsList)
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить заметки.')
        }
      }
    })()

    const unsub = subscribeNotesRealtime(() => {
      void loadNotesData()
        .then(({ active, completed, pendingDeletion }) => {
          if (!cancelled) {
            setActiveNotes(active)
            setCompletedNotes(completed)
            setPendingDeletionNotes(pendingDeletion)
          }
        })
        .catch(() => {
          /* keep current data */
        })
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  useEffect(() => {
    if (!detailNoteId) return
    const stillHere =
      activeNotes.some((n) => n.id === detailNoteId) ||
      completedNotes.some((n) => n.id === detailNoteId) ||
      pendingDeletionNotes.some((n) => n.id === detailNoteId)
    if (!stillHere) setDetailNoteId(null)
  }, [detailNoteId, activeNotes, completedNotes, pendingDeletionNotes])

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])

  const roomsByCat = useMemo(() => groupRoomsByCategoryOrdered(rooms), [rooms])
  const sortedGuests = useMemo(
    () =>
      [...guests].sort((a, b) => {
        const c = (a.lastName ?? '').localeCompare(b.lastName ?? '', 'ru')
        if (c !== 0) return c
        return (a.firstName ?? '').localeCompare(b.firstName ?? '', 'ru')
      }),
    [guests],
  )

  const guestsForNewNoteRoom = useMemo(() => {
    const rid = newFormRoomId.trim()
    if (!rid) return []
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    const windowStartKey = todayKey
    const windowEndKey = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    const list = sortedGuests.filter((g) => guestInRoomForDateWindow(g, rid, windowStartKey, windowEndKey))
    if (newFormGuestId && !list.some((g) => g.id === newFormGuestId)) {
      const g = guestById.get(newFormGuestId)
      if (g) return [g, ...list]
    }
    return list
  }, [sortedGuests, newFormRoomId, newFormGuestId, guestById])

  const detailNote = useMemo(() => {
    if (!detailNoteId) return null
    return (
      activeNotes.find((n) => n.id === detailNoteId) ??
      completedNotes.find((n) => n.id === detailNoteId) ??
      pendingDeletionNotes.find((n) => n.id === detailNoteId) ??
      null
    )
  }, [detailNoteId, activeNotes, completedNotes, pendingDeletionNotes])

  const detailKind = useMemo<'active' | 'completed' | 'pending' | null>(() => {
    if (!detailNoteId) return null
    if (activeNotes.some((n) => n.id === detailNoteId)) return 'active'
    if (completedNotes.some((n) => n.id === detailNoteId)) return 'completed'
    if (pendingDeletionNotes.some((n) => n.id === detailNoteId)) return 'pending'
    return null
  }, [detailNoteId, activeNotes, completedNotes, pendingDeletionNotes])

  useEffect(() => {
    if (!detailNote || !detailKind) return
    if (detailKind === 'active') setEditBody(detailNote.body)
    else setEditBody('')
  }, [detailNote?.id, detailNote?.body, detailKind])

  async function applyNotesRefresh() {
    const data = await loadNotesData()
    setActiveNotes(data.active)
    setCompletedNotes(data.completed)
    setPendingDeletionNotes(data.pendingDeletion)
  }

  const bodyDirty = Boolean(
    detailNote && editBody.trim() !== detailNote.body.trim(),
  )

  async function handleSaveNoteBody() {
    if (!detailNote) return
    if (!activeNotes.some((n) => n.id === detailNote.id)) return
    const next = editBody.trim()
    if (!next) {
      setBodySaveError('Введите текст заметки.')
      return
    }
    if (next === detailNote.body.trim()) return
    setBodySaveError('')
    setBodySaveBusy(true)
    try {
      await updateStickyNoteBody(detailNote.id, next)
      await applyNotesRefresh()
    } catch (e) {
      setBodySaveError(e instanceof Error ? e.message : 'Не удалось сохранить.')
    } finally {
      setBodySaveBusy(false)
    }
  }

  async function handleCompleteActive() {
    if (!user || !detailNote || detailKind !== 'active') return
    setActiveDialogError('')
    setActiveDialogBusy(true)
    setActiveDialogAction('complete')
    try {
      await markStickyNoteCompleted(detailNote.id, {
        userId: user.id,
        userName: user.username,
      })
      await applyNotesRefresh()
      setDetailNoteId(null)
    } catch (e) {
      setActiveDialogError(e instanceof Error ? e.message : 'Не удалось отметить как выполненную.')
    } finally {
      setActiveDialogBusy(false)
      setActiveDialogAction(null)
    }
  }

  async function handleSoftDeleteActive() {
    if (!user || !detailNote || detailKind !== 'active') return
    setActiveDialogError('')
    setActiveDialogBusy(true)
    setActiveDialogAction('delete')
    try {
      await softDeleteStickyNoteFromHome(detailNote.id, {
        userId: user.id,
        userName: user.username,
      })
      await applyNotesRefresh()
      setDetailNoteId(null)
    } catch (e) {
      setActiveDialogError(e instanceof Error ? e.message : 'Не удалось удалить с главной.')
    } finally {
      setActiveDialogBusy(false)
      setActiveDialogAction(null)
    }
  }

  function openNewNoteDialog() {
    setNewFormBody('')
    setNewFormRoomId('')
    setNewFormGuestId('')
    setNewFormDeadline('')
    setNewFormError('')
    setNewNoteOpen(true)
  }

  async function handleCreateNewNote() {
    if (!user) return
    const body = newFormBody.trim()
    if (!body) {
      setNewFormError('Введите текст заметки.')
      return
    }
    setNewFormError('')
    setNewFormSaving(true)
    const deadlineIso =
      newFormDeadline.trim() === ''
        ? null
        : (() => {
            const d = new Date(newFormDeadline)
            return Number.isNaN(d.getTime()) ? null : d.toISOString()
          })()
    let roomId = newFormRoomId.trim() || null
    const guestId = newFormGuestId.trim() || null
    if (guestId) {
      const g = guests.find((x) => x.id === guestId)
      if (!g) {
        setNewFormError('Гость не найден в списке.')
        setNewFormSaving(false)
        return
      }
      if (roomId && g.roomId !== roomId) {
        setNewFormError(
          'Выбранный гость относится к другому номеру. Укажите тот же номер, что в карточке гостя.',
        )
        setNewFormSaving(false)
        return
      }
      if (!roomId) roomId = g.roomId
    }
    try {
      await insertStickyNote({
        body,
        roomId,
        guestId,
        deadlineAt: deadlineIso,
        createdByUserId: user.id,
        createdByName: user.username,
      })
      await applyNotesRefresh()
      setNewNoteOpen(false)
      setNewFormBody('')
      setNewFormRoomId('')
      setNewFormGuestId('')
      setNewFormDeadline('')
    } catch (e) {
      setNewFormError(e instanceof Error ? e.message : 'Не удалось сохранить.')
    } finally {
      setNewFormSaving(false)
    }
  }

  async function handlePurge(noteId: string) {
    if (!showPurgeButton) return
    setDeletingId(noteId)
    try {
      await purgeStickyNote(noteId)
      setActiveNotes((prev) => prev.filter((n) => n.id !== noteId))
      setCompletedNotes((prev) => prev.filter((n) => n.id !== noteId))
      setPendingDeletionNotes((prev) => prev.filter((n) => n.id !== noteId))
      setDetailNoteId((id) => (id === noteId ? null : id))
    } finally {
      setDeletingId(null)
    }
  }

  const tableRowClass =
    'cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

  return (
    <main className="flex min-h-screen w-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <Dialog
        open={detailNoteId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailNoteId(null)
        }}
      >
        <DialogContent>
          {detailNote && detailKind ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detailKind === 'active'
                    ? 'Актуальная заметка'
                    : detailKind === 'completed'
                      ? 'Выполненная заметка'
                      : 'Заметка (ожидает удаления)'}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Полный текст и сведения о заметке
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 text-sm">
                {detailKind === 'active' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="notes-dialog-body">Текст</Label>
                    <textarea
                      id="notes-dialog-body"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={6}
                      disabled={
                        bodySaveBusy ||
                        activeDialogBusy ||
                        deletingId === detailNote.id
                      }
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/80 focus-visible:border-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="Текст заметки…"
                    />
                    {bodySaveError ? (
                      <p className="text-sm text-red-600 dark:text-red-400">{bodySaveError}</p>
                    ) : null}
                    <Button
                      type="button"
                      disabled={
                        !bodyDirty ||
                        bodySaveBusy ||
                        activeDialogBusy ||
                        deletingId === detailNote.id
                      }
                      onClick={() => void handleSaveNoteBody()}
                    >
                      {bodySaveBusy ? 'Сохранение…' : 'Сохранить'}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Текст
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3">
                      {detailNote.body}
                    </p>
                  </div>
                )}
                <dl className="grid gap-2 text-xs">
                  {(() => {
                    const { room, guest } = resolveRoomGuest(detailNote, roomById, guestById)
                    const rows: { term: string; desc: string }[] = [
                      { term: 'Номер', desc: room ? room.name : '—' },
                      { term: 'Гость', desc: guest ? formatGuestFullName(guest) : '—' },
                      {
                        term: 'Дедлайн',
                        desc: formatNoteDateTime(detailNote.deadlineAt, 'не задан'),
                      },
                      {
                        term: 'Создал',
                        desc: detailNote.createdByName?.trim() || 'Не указан',
                      },
                    ]
                    if (detailKind === 'completed') {
                      rows.push(
                        {
                          term: 'Выполнил',
                          desc: detailNote.completedByName?.trim() || 'Не указан',
                        },
                        {
                          term: 'Дата выполнения',
                          desc: formatNoteDateTime(detailNote.completedAt, '—'),
                        },
                      )
                    }
                    if (detailKind === 'pending') {
                      rows.push(
                        {
                          term: 'Удалил с главной',
                          desc: detailNote.deletedByName?.trim() || 'Не указан',
                        },
                        {
                          term: 'Дата удаления с главной',
                          desc: formatNoteDateTime(detailNote.deletedAt, '—'),
                        },
                      )
                    }
                    if (detailKind === 'active') {
                      rows.push({
                        term: 'Статус',
                        desc: 'На главной странице (не выполнена, не удалена)',
                      })
                    }
                    rows.push({
                      term: 'Создана',
                      desc: formatNoteDateTime(detailNote.createdAt, '—'),
                    })
                    return rows.map(({ term, desc }) => (
                      <div key={term} className="grid grid-cols-[7.5rem_1fr] gap-2 border-b border-border/60 py-1.5 last:border-0">
                        <dt className="text-muted-foreground">{term}</dt>
                        <dd className="min-w-0 break-words font-medium">{desc}</dd>
                      </div>
                    ))
                  })()}
                </dl>
                {detailKind === 'active' && user ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    {activeDialogError ? (
                      <p className="text-sm text-red-600 dark:text-red-400">{activeDialogError}</p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        className="flex-1 border-emerald-600/30 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                        disabled={activeDialogBusy}
                        onClick={() => void handleCompleteActive()}
                      >
                        {activeDialogBusy && activeDialogAction === 'complete'
                          ? 'Сохранение…'
                          : 'Выполнено'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                        disabled={activeDialogBusy}
                        onClick={() => void handleSoftDeleteActive()}
                      >
                        {activeDialogBusy && activeDialogAction === 'delete' ? 'Удаление…' : 'Удалить'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      «Выполнено» переносит заметку в раздел выполненных; «Удалить» — мягкое удаление с главной (7
                      дней в «Ожидающие удаления»).
                    </p>
                  </div>
                ) : null}
                {showPurgeButton && detailKind !== 'active' ? (
                  <div className="border-t border-border pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      disabled={deletingId === detailNote.id}
                      onClick={() => void handlePurge(detailNote.id)}
                    >
                      {deletingId === detailNote.id ? 'Удаление…' : 'Удалить навсегда'}
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={newNoteOpen}
        onOpenChange={(open) => {
          setNewNoteOpen(open)
          if (!open) {
            setNewFormError('')
            setNewFormSaving(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая заметка</DialogTitle>
            <DialogDescription>
              Текст виден целиком здесь и на главной (на главной — только начало). Дедлайн окрашивает стикер.
            </DialogDescription>
            {user ? (
              <p className="text-xs text-muted-foreground">
                Автор: <span className="font-medium text-foreground">{user.username}</span>
              </p>
            ) : null}
          </DialogHeader>

          <div className="grid max-h-[min(70vh,32rem)] gap-4 overflow-y-auto py-1 pr-1">
            <div className="grid gap-2">
              <Label htmlFor="notes-new-body">Текст</Label>
              <textarea
                id="notes-new-body"
                value={newFormBody}
                onChange={(e) => setNewFormBody(e.target.value)}
                rows={6}
                disabled={newFormSaving}
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/80 focus-visible:border-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Напоминание, задача…"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-2">
                <Label htmlFor="notes-new-room">Номер (необязательно)</Label>
                <select
                  id="notes-new-room"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={newFormRoomId}
                  disabled={newFormSaving}
                  onChange={(e) => {
                    const next = e.target.value
                    setNewFormRoomId(next)
                    const gid = newFormGuestId.trim()
                    if (!gid) return
                    const g = guests.find((x) => x.id === gid)
                    if (!g || g.roomId !== next) setNewFormGuestId('')
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
                <Label htmlFor="notes-new-guest">Гость в этом номере (необязательно)</Label>
                <select
                  id="notes-new-guest"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={newFormGuestId}
                  disabled={!newFormRoomId.trim() || newFormSaving}
                  onChange={(e) => setNewFormGuestId(e.target.value)}
                >
                  <option value="">
                    {newFormRoomId.trim() ? '—' : 'Сначала выберите номер'}
                  </option>
                  {guestsForNewNoteRoom.map((g) => (
                    <option key={g.id} value={g.id}>
                      {formatGuestFullName(g)}
                    </option>
                  ))}
                </select>
                {newFormRoomId.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    Только гости с проживанием в этом номере в период с сегодняшнего дня по +7 дней (даты заезда/выезда в
                    карточке).
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes-new-deadline">Дедлайн (необязательно)</Label>
              <Input
                id="notes-new-deadline"
                type="datetime-local"
                value={newFormDeadline}
                disabled={newFormSaving}
                onChange={(e) => setNewFormDeadline(e.target.value)}
              />
            </div>
            {newFormError ? <p className="text-sm text-red-600 dark:text-red-400">{newFormError}</p> : null}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={newFormSaving}
                onClick={() => setNewNoteOpen(false)}
              >
                Отмена
              </Button>
              <Button type="button" disabled={newFormSaving || !user} onClick={() => void handleCreateNewNote()}>
                {newFormSaving ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Заметки</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Актуальные</span> — те же заметки, что на главной
          (не выполнены и не удалены с главной). Выполненные и удалённые с главной хранятся в базе 7 дней, затем
          удаляются автоматически. Разделы «Выполненные» и «Ожидающие удаления» по умолчанию свёрнуты — нажмите
          заголовок, чтобы показать таблицу. Строка таблицы открывает подробности.
          {showPurgeButton
            ? ' Окончательное удаление архивных записей — в окне заметки (только администратор).'
            : ' Окончательное удаление архива до истечения срока доступно только администратору.'}
        </p>
        {user ? (
          <Button type="button" className="w-fit shrink-0 gap-2" onClick={openNewNoteDialog}>
            <Plus className="h-4 w-4" aria-hidden />
            Новая заметка
          </Button>
        ) : null}
      </header>

      {loadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {loadError}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight">Актуальные</h2>
        <p className="text-xs text-muted-foreground">
          Отображаются на главной странице; создать и править текст можно здесь или на главной.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="min-w-[12rem] px-2 py-1.5 font-medium">Текст</th>
                <th className="px-2 py-1.5 font-medium">Номер</th>
                <th className="min-w-[8rem] px-2 py-1.5 font-medium">Гость</th>
                <th className="px-2 py-1.5 font-medium">Создал</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">Дедлайн</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">Создана</th>
              </tr>
            </thead>
            <tbody>
              {activeNotes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                    Нет актуальных заметок.
                  </td>
                </tr>
              ) : (
                activeNotes.map((note) => {
                  const { room, guest } = resolveRoomGuest(note, roomById, guestById)
                  const label = noteBodyPreview(note.body)
                  return (
                    <tr
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      className={tableRowClass}
                      onClick={() => setDetailNoteId(note.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDetailNoteId(note.id)
                        }
                      }}
                      aria-label={`Заметка: ${label}`}
                    >
                      <td className="max-w-[20rem] px-2 py-1.5">
                        <span className="line-clamp-2 break-words">{label}</span>
                      </td>
                      <td className="max-w-[6rem] truncate px-2 py-1.5 text-muted-foreground">
                        {room?.name ?? '—'}
                      </td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5 text-muted-foreground">
                        {guest ? formatGuestFullName(guest) : '—'}
                      </td>
                      <td className="max-w-[8rem] truncate px-2 py-1.5">
                        {note.createdByName?.trim() || '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                        {formatNoteDateTime(note.deadlineAt, '—')}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                        {formatNoteDateTime(note.createdAt)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-expanded={completedSectionOpen}
          id="notes-section-completed"
          onClick={() => setCompletedSectionOpen((o) => !o)}
        >
          <span className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
            {completedSectionOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">Выполненные</span>
            <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
              ({completedNotes.length})
            </span>
          </span>
        </button>
        {completedSectionOpen ? (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="min-w-[12rem] px-2 py-1.5 font-medium">Текст</th>
                  <th className="px-2 py-1.5 font-medium">Номер</th>
                  <th className="min-w-[8rem] px-2 py-1.5 font-medium">Гость</th>
                  <th className="px-2 py-1.5 font-medium">Создал</th>
                  <th className="px-2 py-1.5 font-medium">Выполнил</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">Дата выполнения</th>
                </tr>
              </thead>
              <tbody>
                {completedNotes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                      Выполненных заметок пока нет.
                    </td>
                  </tr>
                ) : (
                  completedNotes.map((note) => {
                    const { room, guest } = resolveRoomGuest(note, roomById, guestById)
                    const label = noteBodyPreview(note.body)
                    return (
                      <tr
                        key={note.id}
                        role="button"
                        tabIndex={0}
                        className={tableRowClass}
                        onClick={() => setDetailNoteId(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setDetailNoteId(note.id)
                          }
                        }}
                        aria-label={`Заметка: ${label}`}
                      >
                        <td className="max-w-[20rem] px-2 py-1.5">
                          <span className="line-clamp-2 break-words">{label}</span>
                        </td>
                        <td className="max-w-[6rem] truncate px-2 py-1.5 text-muted-foreground">
                          {room?.name ?? '—'}
                        </td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-muted-foreground">
                          {guest ? formatGuestFullName(guest) : '—'}
                        </td>
                        <td className="max-w-[8rem] truncate px-2 py-1.5">
                          {note.createdByName?.trim() || '—'}
                        </td>
                        <td className="max-w-[8rem] truncate px-2 py-1.5">
                          {note.completedByName?.trim() || '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                          {formatNoteDateTime(note.completedAt)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-expanded={pendingSectionOpen}
          id="notes-section-pending"
          onClick={() => setPendingSectionOpen((o) => !o)}
        >
          <span className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
            {pendingSectionOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">Ожидающие удаления</span>
            <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
              ({pendingDeletionNotes.length})
            </span>
          </span>
        </button>
        {pendingSectionOpen ? (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="min-w-[12rem] px-2 py-1.5 font-medium">Текст</th>
                  <th className="px-2 py-1.5 font-medium">Номер</th>
                  <th className="min-w-[8rem] px-2 py-1.5 font-medium">Гость</th>
                  <th className="px-2 py-1.5 font-medium">Создал</th>
                  <th className="px-2 py-1.5 font-medium">Удалил с главной</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">Дата удаления</th>
                </tr>
              </thead>
              <tbody>
                {pendingDeletionNotes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                      Нет заметок, удалённых с главной страницы.
                    </td>
                  </tr>
                ) : (
                  pendingDeletionNotes.map((note) => {
                    const { room, guest } = resolveRoomGuest(note, roomById, guestById)
                    const label = noteBodyPreview(note.body)
                    return (
                      <tr
                        key={note.id}
                        role="button"
                        tabIndex={0}
                        className={tableRowClass}
                        onClick={() => setDetailNoteId(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setDetailNoteId(note.id)
                          }
                        }}
                        aria-label={`Заметка: ${label}`}
                      >
                        <td className="max-w-[20rem] px-2 py-1.5">
                          <span className="line-clamp-2 break-words">{label}</span>
                        </td>
                        <td className="max-w-[6rem] truncate px-2 py-1.5 text-muted-foreground">
                          {room?.name ?? '—'}
                        </td>
                        <td className="max-w-[10rem] truncate px-2 py-1.5 text-muted-foreground">
                          {guest ? formatGuestFullName(guest) : '—'}
                        </td>
                        <td className="max-w-[8rem] truncate px-2 py-1.5">
                          {note.createdByName?.trim() || '—'}
                        </td>
                        <td className="max-w-[8rem] truncate px-2 py-1.5">
                          {note.deletedByName?.trim() || '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                          {formatNoteDateTime(note.deletedAt)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  )
}
