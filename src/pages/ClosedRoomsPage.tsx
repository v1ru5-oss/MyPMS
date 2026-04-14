import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

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
import { isAdminUser, isConciergeUser, isSeniorTechnicianUser, isTechnicianUser } from '@/lib/access'
import { fetchRoomClosures, fetchRooms, fetchTechnicians, setRoomClosures } from '@/lib/pms-db'
import type { PublicUser, Room, RoomClosure } from '@/types/models'

function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDateTimeInputValue(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm', { locale: ru })
  } catch {
    return '—'
  }
}

export default function ClosedRoomsPage() {
  const { user } = useAuth()
  const admin = user ? isAdminUser(user) : false
  const concierge = user ? isConciergeUser(user) : false
  const technician = user ? isTechnicianUser(user) : false
  const seniorTechnician = user ? isSeniorTechnicianUser(user) : false
  const canAssignTechnician = admin || seniorTechnician || concierge
  const location = useLocation()
  const [rooms, setRooms] = useState<Room[]>([])
  const [closures, setClosures] = useState<RoomClosure[]>([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailDialogClosureId, setDetailDialogClosureId] = useState<string | null>(null)
  const [checkComment, setCheckComment] = useState('')
  const [technicians, setTechnicians] = useState<PublicUser[]>([])
  const [detailAssignedTechnicianId, setDetailAssignedTechnicianId] = useState<string>('')
  const [editDialog, setEditDialog] = useState<{
    roomId: string
    closureId: string
    startAt: string
    endAt: string
    reason: string
    repairCompletedAt: string
    resolvedIssues: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void (async () => {
      try {
        const [r, c, tech] = await Promise.all([fetchRooms(), fetchRoomClosures(), fetchTechnicians()])
        if (!cancelled) {
          setRooms(r)
          setClosures(c)
          setTechnicians(tech)
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить закрытые номера.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.key])

  const rows = useMemo(() => {
    return closures
      .map((closure) => ({
        closure,
        room: rooms.find((room) => room.id === closure.roomId),
      }))
      .sort((a, b) => {
        const roomA = a.room?.name ?? a.closure.roomId
        const roomB = b.room?.name ?? b.closure.roomId
        const c = roomA.localeCompare(roomB, 'ru')
        if (c !== 0) return c
        return a.closure.startAt.localeCompare(b.closure.startAt)
      })
  }, [closures, rooms])

  const detailClosure = useMemo(
    () => closures.find((item) => item.id === detailDialogClosureId) ?? null,
    [closures, detailDialogClosureId],
  )
  const detailRoom = useMemo(
    () => (detailClosure ? rooms.find((item) => item.id === detailClosure.roomId) : undefined),
    [rooms, detailClosure],
  )

  async function persistForRoom(roomId: string, nextClosures: RoomClosure[]) {
    await setRoomClosures(
      roomId,
      nextClosures.map((item) => ({
        id: item.id,
        startAt: item.startAt,
        endAt: item.endAt,
        reason: item.reason,
        createdByUserId: item.createdByUserId ?? null,
        createdByName: item.createdByName ?? null,
        repairCompletedAt: item.repairCompletedAt ?? null,
        resolvedIssues: item.resolvedIssues ?? null,
        repairedByUserId: item.repairedByUserId ?? null,
        repairedByName: item.repairedByName ?? null,
        checkedAt: item.checkedAt ?? null,
        checkedByUserId: item.checkedByUserId ?? null,
        checkedByName: item.checkedByName ?? null,
        checkedByRole: item.checkedByRole ?? null,
        checkedComment: item.checkedComment ?? null,
        assignedTechnicianUserId: item.assignedTechnicianUserId ?? null,
        assignedTechnicianName: item.assignedTechnicianName ?? null,
      })),
    )
  }

  function openEdit(closure: RoomClosure) {
    setActionError('')
    setEditDialog({
      roomId: closure.roomId,
      closureId: closure.id,
      startAt: toLocalDateTimeInputValue(closure.startAt),
      endAt: toLocalDateTimeInputValue(closure.endAt),
      reason: closure.reason ?? '',
      repairCompletedAt: toLocalDateTimeInputValue(closure.repairCompletedAt ?? ''),
      resolvedIssues: closure.resolvedIssues ?? '',
    })
  }

  function openDetail(closure: RoomClosure) {
    setActionError('')
    setDetailDialogClosureId(closure.id)
    setCheckComment(closure.checkedComment ?? '')
    setDetailAssignedTechnicianId(closure.assignedTechnicianUserId ?? '')
  }

  async function handleSaveTechnicianAssignment(closure: RoomClosure) {
    const id = detailAssignedTechnicianId.trim()
    const picked = id ? technicians.find((t) => t.id === id) : undefined
    const roomClosures = closures.filter((x) => x.roomId === closure.roomId)
    const next = roomClosures.map((x) =>
      x.id === closure.id
        ? {
            ...x,
            assignedTechnicianUserId: picked?.id ?? null,
            assignedTechnicianName: picked ? picked.username.trim() || picked.email || null : null,
          }
        : x,
    )
    setSaving(true)
    setActionError('')
    try {
      await persistForRoom(closure.roomId, next)
      setClosures((prev) => prev.map((x) => next.find((n) => n.id === x.id) ?? x))
    } catch {
      setActionError('Не удалось сохранить назначение техника.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveEdit() {
    if (!editDialog) return
    setActionError('')
    const startAt = fromLocalDateTimeInputValue(editDialog.startAt)
    const endAt = fromLocalDateTimeInputValue(editDialog.endAt)
    if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
      setActionError('Дата окончания закрытия не может быть раньше даты начала.')
      return
    }
    const repairCompletedAt = editDialog.repairCompletedAt.trim()
      ? fromLocalDateTimeInputValue(editDialog.repairCompletedAt)
      : null
    const roomId = editDialog.roomId
    const roomClosures = closures.filter((item) => item.roomId === roomId)
    const nextRoomClosures = roomClosures.map((item) =>
      item.id === editDialog.closureId
        ? {
            ...item,
            startAt,
            endAt,
            reason: editDialog.reason.trim(),
            repairCompletedAt,
            resolvedIssues: editDialog.resolvedIssues.trim() || null,
          }
        : item,
    )
    setSaving(true)
    try {
      await persistForRoom(roomId, nextRoomClosures)
      setClosures((prev) => prev.map((item) => nextRoomClosures.find((x) => x.id === item.id) ?? item))
      setEditDialog(null)
    } catch {
      setActionError('Не удалось сохранить изменения.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEdit() {
    if (!editDialog) return
    setActionError('')
    const roomId = editDialog.roomId
    const roomClosures = closures.filter((item) => item.roomId === roomId)
    const nextRoomClosures = roomClosures.filter((item) => item.id !== editDialog.closureId)
    setSaving(true)
    try {
      await persistForRoom(roomId, nextRoomClosures)
      setClosures((prev) => prev.filter((item) => item.id !== editDialog.closureId))
      setEditDialog(null)
    } catch {
      setActionError('Не удалось удалить закрытие.')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkDone(closure: RoomClosure) {
    const roomClosures = closures.filter((x) => x.roomId === closure.roomId)
    const next = roomClosures.map((x) =>
      x.id === closure.id
        ? {
            ...x,
            repairCompletedAt: x.repairCompletedAt ?? new Date().toISOString(),
            resolvedIssues: x.resolvedIssues ?? '',
            repairedByUserId: user?.id ?? null,
            repairedByName: user?.username ?? null,
          }
        : x,
    )
    setSaving(true)
    setActionError('')
    try {
      await persistForRoom(closure.roomId, next)
      setClosures((prev) => prev.map((x) => next.find((n) => n.id === x.id) ?? x))
    } catch {
      setActionError('Не удалось отметить работу как выполненную.')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkChecked(closure: RoomClosure) {
    const roomClosures = closures.filter((x) => x.roomId === closure.roomId)
    const next = roomClosures.map((x) =>
      x.id === closure.id
        ? {
            ...x,
            checkedAt: new Date().toISOString(),
            checkedByUserId: user?.id ?? null,
            checkedByName: user?.username ?? null,
            checkedByRole: seniorTechnician ? 'Старший техник' : 'Администратор',
            checkedComment: checkComment.trim() || null,
          }
        : x,
    )
    setSaving(true)
    setActionError('')
    try {
      await persistForRoom(closure.roomId, next)
      setClosures((prev) => prev.map((x) => next.find((n) => n.id === x.id) ?? x))
    } catch {
      setActionError('Не удалось проставить отметку проверки.')
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenRoom(closure: RoomClosure) {
    const roomClosures = closures.filter((x) => x.roomId === closure.roomId)
    const next = roomClosures.filter((x) => x.id !== closure.id)
    setSaving(true)
    setActionError('')
    try {
      await persistForRoom(closure.roomId, next)
      setClosures((prev) => prev.filter((x) => x.id !== closure.id))
      setDetailDialogClosureId(null)
    } catch {
      setActionError('Не удалось открыть номер.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-screen w-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-3xl font-semibold">Закрытые номера</h1>
        <p className="text-sm text-muted-foreground">
          Управление периодами закрытия на обслуживание и ремонт.
        </p>
        {loadError ? (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {loadError}
          </p>
        ) : null}
      </header>

      <section className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[940px] border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-2 py-1.5 font-medium">Номер</th>
              <th className="px-2 py-1.5 font-medium">Категория номера</th>
              <th className="px-2 py-1.5 font-medium">Период закрытия</th>
              <th className="px-2 py-1.5 font-medium">Кто создал</th>
              <th className="px-2 py-1.5 font-medium">Назначенный техник</th>
              <th className="px-2 py-1.5 font-medium">Статус</th>
              <th className="px-2 py-1.5 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                  {loadError ? 'Нет данных.' : 'Закрытых номеров пока нет.'}
                </td>
              </tr>
            ) : (
              rows.map(({ closure, room }) => (
                <tr
                  key={closure.id}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-muted/40 last:border-0"
                  onClick={() => openDetail(closure)}
                >
                  <td className="px-2 py-1.5 font-medium">{room?.name ?? closure.roomId}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{room?.category ?? '—'}</td>
                  <td className="px-2 py-1.5">{formatDateTime(closure.startAt)} - {formatDateTime(closure.endAt)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{closure.createdByName ?? '—'}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{closure.assignedTechnicianName?.trim() || '—'}</td>
                  <td className="px-2 py-1.5">
                    {closure.checkedAt ? (
                      <span className="rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-100">
                        Проверено
                      </span>
                    ) : closure.repairCompletedAt ? (
                      <span className="rounded-md border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-900 dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-100">
                        Выполнено
                      </span>
                    ) : (
                      <span className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
                        В работе
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(closure)
                      }}
                    >
                      Редактировать
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <Dialog
        open={detailDialogClosureId !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setDetailDialogClosureId(null)
            setCheckComment('')
            setDetailAssignedTechnicianId('')
            setActionError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Информация по закрытому номеру</DialogTitle>
            <DialogDescription>Полные данные и действия по ремонту.</DialogDescription>
          </DialogHeader>
          {detailClosure ? (
            <div className="grid gap-3 py-2">
              <p className="text-sm"><span className="font-medium">Номер:</span> {detailRoom?.name ?? detailClosure.roomId}</p>
              <p className="text-sm"><span className="font-medium">Категория:</span> {detailRoom?.category ?? '—'}</p>
              <p className="text-sm"><span className="font-medium">Период:</span> {formatDateTime(detailClosure.startAt)} - {formatDateTime(detailClosure.endAt)}</p>
              <p className="text-sm"><span className="font-medium">Кто создал:</span> {detailClosure.createdByName ?? '—'}</p>
              <div className="grid gap-2">
                <Label htmlFor="closedRoomAssignedTech">Назначенный техник</Label>
                {canAssignTechnician ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <select
                      id="closedRoomAssignedTech"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md"
                      value={detailAssignedTechnicianId}
                      onChange={(e) => setDetailAssignedTechnicianId(e.target.value)}
                    >
                      <option value="">Не назначен</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.username.trim() || t.email}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={saving}
                      onClick={() => void handleSaveTechnicianAssignment(detailClosure)}
                    >
                      Сохранить назначение
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{detailClosure.assignedTechnicianName?.trim() || '—'}</p>
                )}
              </div>
              <p className="text-sm"><span className="font-medium">Причина:</span> {detailClosure.reason || '—'}</p>
              <p className="text-sm"><span className="font-medium">Дата ремонта:</span> {formatDateTime(detailClosure.repairCompletedAt)}</p>
              <p className="text-sm"><span className="font-medium">Устраненные недостатки:</span> {detailClosure.resolvedIssues?.trim() || '—'}</p>
              <p className="text-sm"><span className="font-medium">Выполнил работы:</span> {detailClosure.repairedByName?.trim() || '—'}</p>
              <p className="text-sm"><span className="font-medium">Проверка:</span> {detailClosure.checkedAt ? `Проверено — ${detailClosure.checkedByName ?? '—'} ${detailClosure.checkedByRole ? `(${detailClosure.checkedByRole})` : ''} · ${formatDateTime(detailClosure.checkedAt)}` : 'Не проверено'}</p>
              <div className="grid gap-2">
                <Label htmlFor="closedRoomCheckedComment">Комментарий по итогам проверки</Label>
                <textarea
                  id="closedRoomCheckedComment"
                  className="min-h-[84px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={checkComment}
                  onChange={(event) => setCheckComment(event.target.value)}
                />
              </div>
              {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                {(admin || technician || seniorTechnician) ? (
                  <Button type="button" variant="outline" onClick={() => void handleMarkDone(detailClosure)} disabled={saving}>
                    Выполнено
                  </Button>
                ) : null}
                {(seniorTechnician || admin) && !detailClosure.checkedAt ? (
                  <Button type="button" variant="outline" onClick={() => void handleMarkChecked(detailClosure)} disabled={saving}>
                    Проверено
                  </Button>
                ) : null}
                {detailClosure.checkedAt ? (
                  <Button type="button" onClick={() => void handleOpenRoom(detailClosure)} disabled={saving}>
                    Открыть номер
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editDialog !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setEditDialog(null)
            setActionError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать закрытие номера</DialogTitle>
            <DialogDescription>Измените период, комментарий и данные по ремонту.</DialogDescription>
          </DialogHeader>
          {editDialog ? (
            <div className="grid gap-3 py-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="closedRoomEditStart">Начало</Label>
                  <Input id="closedRoomEditStart" type="datetime-local" value={editDialog.startAt} onChange={(event) => setEditDialog((prev) => (prev ? { ...prev, startAt: event.target.value } : prev))} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="closedRoomEditEnd">Окончание</Label>
                  <Input id="closedRoomEditEnd" type="datetime-local" value={editDialog.endAt} onChange={(event) => setEditDialog((prev) => (prev ? { ...prev, endAt: event.target.value } : prev))} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closedRoomEditReason">Комментарий (причина)</Label>
                <Input id="closedRoomEditReason" value={editDialog.reason} onChange={(event) => setEditDialog((prev) => (prev ? { ...prev, reason: event.target.value } : prev))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closedRoomRepairDate">Дата ремонта</Label>
                <Input id="closedRoomRepairDate" type="datetime-local" value={editDialog.repairCompletedAt} onChange={(event) => setEditDialog((prev) => (prev ? { ...prev, repairCompletedAt: event.target.value } : prev))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closedRoomResolvedIssues">Устраненные недостатки</Label>
                <textarea id="closedRoomResolvedIssues" className="min-h-[84px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={editDialog.resolvedIssues} onChange={(event) => setEditDialog((prev) => (prev ? { ...prev, resolvedIssues: event.target.value } : prev))} />
              </div>
              {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
              <div className="flex justify-end gap-2">
                {(admin || seniorTechnician) ? (
                  <Button type="button" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40" onClick={() => void handleDeleteEdit()} disabled={saving}>
                    Удалить
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => setEditDialog(null)} disabled={saving}>Отмена</Button>
                <Button type="button" onClick={() => void handleSaveEdit()} disabled={saving || (!admin && !technician && !seniorTechnician)}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}
