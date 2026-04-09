import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Check, CircleDashed, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  checkInUrgentWithinTwoHours,
  findNextCheckInForRoom,
  formatNextCheckInHoverTitle,
} from '@/lib/next-room-checkin'
import { nextRoomCleaningStatusInCycle } from '@/lib/room-cleaning-cycle'
import { fetchBookings, fetchRooms, updateRoomCleaningStatus } from '@/lib/pms-db'
import { cn } from '@/lib/utils'
import { type Booking, type Room, type RoomCleaningStatus } from '@/types/models'

function cleaningAuditCaption(at: string | null | undefined, who: string | null | undefined): string {
  const parts: string[] = []
  if (at) {
    try {
      parts.push(format(parseISO(at), 'd MMM yyyy, HH:mm', { locale: ru }))
    } catch {
      /* ignore */
    }
  }
  const w = who?.trim()
  if (w) parts.push(w)
  return parts.join(' · ')
}

export default function RoomCleaningPage() {
  const location = useLocation()
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void (async () => {
      try {
        const [list, bk] = await Promise.all([fetchRooms(), fetchBookings()])
        if (!cancelled) {
          setRooms(list)
          setBookings(bk)
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить номера.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.key])

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => {
      const catA = a.category ?? ''
      const catB = b.category ?? ''
      const c = catA.localeCompare(catB, 'ru')
      if (c !== 0) return c
      return a.name.localeCompare(b.name, 'ru')
    })
  }, [rooms])

  const roomsByCategory = useMemo(() => {
    const map = new Map<string, Room[]>()
    for (const room of sortedRooms) {
      const c = room.category ?? 'Без категории'
      if (!map.has(c)) map.set(c, [])
      map.get(c)!.push(room)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru'))
  }, [sortedRooms])

  async function persistCleaningStatus(roomId: string, resolved: RoomCleaningStatus | null) {
    const prevRooms = rooms
    setSaveError('')
    setRooms((list) =>
      list.map((r) => (r.id === roomId ? { ...r, cleaningStatus: resolved } : r)),
    )
    setSavingRoomId(roomId)
    try {
      const audit = await updateRoomCleaningStatus(roomId, resolved)
      setRooms((list) =>
        list.map((r) =>
          r.id === roomId
            ? {
                ...r,
                cleaningStatus: resolved,
                cleaningUpdatedAt: audit.cleaningUpdatedAt,
                cleaningUpdatedById: audit.cleaningUpdatedById,
                cleaningUpdatedByDisplay: audit.cleaningUpdatedByDisplay,
              }
            : r,
        ),
      )
    } catch (e) {
      setRooms(prevRooms)
      setSaveError(e instanceof Error ? e.message : 'Не удалось сохранить отметку.')
    } finally {
      setSavingRoomId(null)
    }
  }

  function cycleStatus(roomId: string) {
    const current = rooms.find((r) => r.id === roomId)?.cleaningStatus ?? null
    void persistCleaningStatus(roomId, nextRoomCleaningStatusInCycle(current))
  }

  return (
    <main className="flex min-h-screen w-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">Уборка в номерах</h1>
          <p className="text-sm text-muted-foreground">
            Нажмите на карточку номера: по кругу — без отметки → убрано → не убрано.
          </p>
          {loadError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {loadError}
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {saveError}
            </p>
          ) : null}
        </div>
      </header>

      <section className="space-y-8">
        {sortedRooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loadError ? 'Нет данных.' : 'Номера загружаются или список пуст.'}
          </p>
        ) : (
          roomsByCategory.map(([category, catRooms]) => (
            <div key={category}>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {category}
              </h2>
              <div className="flex flex-wrap gap-2">
                {catRooms.map((room) => {
                  const status = room.cleaningStatus ?? null
                  const busy = savingRoomId === room.id
                  const next =
                    status === 'dirty' ? findNextCheckInForRoom(room.id, bookings) : null
                  const urgent = next ? checkInUrgentWithinTwoHours(next.at) : false
                  const label =
                    status === 'clean'
                      ? 'Убрано — следующий клик: не убрано'
                      : status === 'dirty'
                        ? 'Не убрано — следующий клик: снять отметку'
                        : 'Без отметки — следующий клик: убрано'
                  const auditText = cleaningAuditCaption(
                    room.cleaningUpdatedAt,
                    room.cleaningUpdatedByDisplay,
                  )
                  const cardTitle =
                    status === 'dirty' && next
                      ? `${category} · ${room.name}. ${formatNextCheckInHoverTitle(next.at)}`
                      : status === 'dirty'
                        ? `${category} · ${room.name} · вместимость ${room.capacity}. Нет предстоящего заезда по брони`
                        : `${category} · ${room.name} · вместимость ${room.capacity}`
                  return (
                    <div
                      key={room.id}
                      className="flex max-w-[11rem] min-w-[6.5rem] flex-col items-stretch gap-1"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex w-full max-w-full">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => cycleStatus(room.id)}
                              aria-label={`${room.name}. ${label}`}
                              className={cn(
                                buttonVariants({ variant: 'outline', size: 'sm' }),
                                'relative h-auto w-full min-w-0 flex-col gap-1.5 py-2.5 transition-colors',
                              status === 'clean' &&
                                'border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-50 dark:hover:bg-emerald-950/70',
                              status === 'dirty' &&
                                'border-red-600 bg-red-50 text-red-950 hover:bg-red-100 dark:border-red-700 dark:bg-red-950/50 dark:text-red-50 dark:hover:bg-red-950/70',
                              status === 'dirty' &&
                                urgent &&
                                'border-2 border-amber-500 ring-2 ring-amber-500/90 dark:border-amber-400 dark:ring-amber-400/80',
                              busy && 'pointer-events-none opacity-60',
                            )}
                          >
                            {urgent ? (
                              <span
                                className="absolute right-1 top-1 rounded-sm bg-amber-500 px-0.5 text-[10px] font-bold leading-none text-white shadow-sm dark:bg-amber-400 dark:text-amber-950"
                                aria-hidden
                              >
                                !
                              </span>
                            ) : null}
                            <span className="w-full px-0.5 text-center text-xs font-semibold leading-tight">
                              {room.name}
                            </span>
                            <span className="flex h-6 items-center justify-center">
                              {status === 'clean' ? (
                                <Check className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden />
                              ) : status === 'dirty' ? (
                                <X className="h-5 w-5 text-red-700 dark:text-red-300" aria-hidden />
                              ) : (
                                <CircleDashed
                                  className="h-5 w-5 text-muted-foreground"
                                  aria-hidden
                                />
                              )}
                            </span>
                            </button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="whitespace-normal">
                          {cardTitle}
                        </TooltipContent>
                      </Tooltip>
                      {auditText ? (
                        <p className="px-0.5 text-center text-[10px] leading-tight text-muted-foreground">
                          {auditText}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  )
}
