import { addDays, format, parseISO, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { BookingShakhmatka } from '@/components/BookingShakhmatka'
import { CitizenshipSelect } from '@/components/CitizenshipSelect'
import { OccupancyTodaySummary } from '@/components/OccupancyTodaySummary'
import { StickyNotesBoard } from '@/components/StickyNotesBoard'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isAdminUser, isConciergeUser, isHousekeeperUser } from '@/lib/access'
import {
  checkInTimeForTimeInput,
  checkOutTimeForTimeInput,
  normalizeCheckInTime,
} from '@/lib/booking-check-in-time'
import { useAuth } from '@/contexts/AuthContext'
import { isBookingGuestCheckInApproved } from '@/lib/guest-checkin'
import {
  buildGuestDisplayName,
  parseGuestNameFromLabel,
} from '@/lib/guest-name'
import {
  checkInUrgentWithinTwoHours,
  findNextCheckInForRoom,
  formatNextCheckInHoverTitle,
} from '@/lib/next-room-checkin'
import { isRoomFreeForBookingRange } from '@/lib/room-booking-availability'
import { nextRoomCleaningStatusInCycle } from '@/lib/room-cleaning-cycle'
import {
  fetchBookingSources,
  fetchBookings,
  fetchCitizenships,
  fetchGuests,
  fetchRooms,
  fetchStickyNotes,
  subscribeNotesRealtime,
  subscribeRoomsRealtime,
  syncBookings,
  syncGuests,
  syncGuestsAndBookings,
  updateRoomCleaningStatus,
} from '@/lib/pms-db'
import { cn } from '@/lib/utils'
import {
  type Booking,
  type BookingSource,
  type Citizenship,
  type Guest,
  type Room,
  type RoomCleaningStatus,
  type StickyNote,
} from '@/types/models'

type NewBookingForm = {
  roomId: string
  firstName: string
  lastName: string
  middleName: string
  citizenshipId: string
  phone: string
  email: string
  bookingSourceId: string
  startDate: string
  checkInTime: string
  checkOutTime: string
  endDate: string
  note: string
}

function defaultBookingSourceIdForForm(sources: BookingSource[]): string {
  if (sources.length === 0) return ''
  const site = sources.find((s) => s.name === 'Сайт')
  return String(site?.id ?? sources[0]!.id)
}

/** Совпадает с `citizenships.name` в миграции БД. */
const DEFAULT_CITIZENSHIP_NAME = 'Российская Федерация'

function defaultCitizenshipIdForForm(citizenships: Citizenship[]): string {
  const ru = citizenships.find((c) => c.name === DEFAULT_CITIZENSHIP_NAME)
  return ru ? String(ru.id) : ''
}

function emptyNewBookingForm(
  roomId: string,
  sources: BookingSource[],
  citizenships: Citizenship[],
): NewBookingForm {
  const today = format(new Date(), 'yyyy-MM-dd')
  return {
    roomId,
    firstName: '',
    lastName: '',
    middleName: '',
    citizenshipId: defaultCitizenshipIdForForm(citizenships),
    phone: '',
    email: '',
    bookingSourceId: defaultBookingSourceIdForForm(sources),
    startDate: today,
    checkInTime: '14:00',
    checkOutTime: '00:00',
    endDate: today,
    note: '',
  }
}

/** Группировка номеров по категории (как на шахматке), категории и номера по алфавиту */
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

const EDIT_BOOKING_TIME_WHEEL_STEP_MIN = 15

/** Скролл над сфокусированным type="date": ±1 день (без прокрутки страницы). */
function useBookingDateInputWheel(
  value: string,
  enabled: boolean,
  onCommit: (next: string) => void,
) {
  const ref = useRef<HTMLInputElement>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return
      e.preventDefault()
      e.stopPropagation()
      const d = parseISO(value)
      if (Number.isNaN(d.getTime())) return
      const dir = e.deltaY < 0 ? 1 : -1
      onCommitRef.current(format(addDays(d, dir), 'yyyy-MM-dd'))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [value, enabled])
  return ref
}

/** Скролл над сфокусированным type="time": шаг 15 минут по кругу суток. */
function useBookingTimeInputWheel(
  value: string,
  enabled: boolean,
  onCommit: (next: string) => void,
) {
  const ref = useRef<HTMLInputElement>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return
      e.preventDefault()
      e.stopPropagation()
      const n = normalizeCheckInTime(value)
      if (!n) return
      const [hs, ms] = n.split(':')
      const h = parseInt(hs!, 10)
      const min = parseInt(ms!, 10)
      if (!Number.isFinite(h) || !Number.isFinite(min)) return
      let total = h * 60 + min
      const dir = e.deltaY < 0 ? 1 : -1
      total += dir * EDIT_BOOKING_TIME_WHEEL_STEP_MIN
      total = ((total % (24 * 60)) + (24 * 60)) % (24 * 60)
      const nh = Math.floor(total / 60)
      const nm = total % 60
      onCommitRef.current(`${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [value, enabled])
  return ref
}

function HomePage() {
  const { user } = useAuth()
  const admin = user ? isAdminUser(user) : false
  const conciergeOps = user ? admin || isConciergeUser(user) : false
  const housekeeperOnly = user ? isHousekeeperUser(user) && !admin : false
  const canEditRoomCleaningFromGrid = user ? admin || isHousekeeperUser(user) : false

  const [rooms, setRooms] = useState<Room[]>([])
  const [dataReady, setDataReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const roomsByCategoryForBooking = useMemo(() => groupRoomsByCategoryOrdered(rooms), [rooms])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingForm, setBookingForm] = useState<NewBookingForm>(() =>
    emptyNewBookingForm('', [], []),
  )
  const [citizenships, setCitizenships] = useState<Citizenship[]>([])
  const [bookingSources, setBookingSources] = useState<BookingSource[]>([])
  const skipNewBookingOpenResetRef = useRef(false)
  const [guests, setGuests] = useState<Guest[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [roomCleaningSaveError, setRoomCleaningSaveError] = useState('')
  const [roomCleaningSavingRoomId, setRoomCleaningSavingRoomId] = useState<string | null>(null)
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([])
  const [stickyNotesLoadError, setStickyNotesLoadError] = useState('')

  const [editBookingOpen, setEditBookingOpen] = useState(false)
  const [editBookingForm, setEditBookingForm] = useState<{
    bookingId: string
    roomId: string
    firstName: string
    lastName: string
    middleName: string
    citizenshipId: string
    phone: string
    email: string
    bookingSourceId: string
    startDate: string
    checkInTime: string
    checkOutTime: string
    endDate: string
  } | null>(null)
  const [editBookingError, setEditBookingError] = useState('')

  const editBkWheelEnabled = editBookingOpen && editBookingForm !== null
  const editWheelStartDate = editBookingForm?.startDate ?? ''
  const editWheelEndDate = editBookingForm?.endDate ?? ''
  const editWheelCheckIn = editBookingForm?.checkInTime ?? '00:00'
  const editWheelCheckOut = editBookingForm?.checkOutTime ?? '00:00'

  const editWheelStartDateRef = useBookingDateInputWheel(
    editWheelStartDate,
    editBkWheelEnabled,
    useCallback((v) => {
      setEditBookingForm((p) => (p ? { ...p, startDate: v } : p))
    }, []),
  )
  const editWheelEndDateRef = useBookingDateInputWheel(
    editWheelEndDate,
    editBkWheelEnabled,
    useCallback((v) => {
      setEditBookingForm((p) => (p ? { ...p, endDate: v } : p))
    }, []),
  )
  const editWheelCheckInRef = useBookingTimeInputWheel(
    editWheelCheckIn,
    editBkWheelEnabled,
    useCallback((v) => {
      setEditBookingForm((p) => (p ? { ...p, checkInTime: v } : p))
    }, []),
  )
  const editWheelCheckOutRef = useBookingTimeInputWheel(
    editWheelCheckOut,
    editBkWheelEnabled,
    useCallback((v) => {
      setEditBookingForm((p) => (p ? { ...p, checkOutTime: v } : p))
    }, []),
  )

  const roomsAvailableForNewBooking = useMemo(() => {
    const start = parseISO(bookingForm.startDate)
    const end = parseISO(bookingForm.endDate)
    const datesValid =
      !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start
    if (!datesValid) return roomsByCategoryForBooking
    return roomsByCategoryForBooking
      .map(({ category, rooms: catRooms }) => ({
        category,
        rooms: catRooms.filter((room) =>
          isRoomFreeForBookingRange(
            room.id,
            bookingForm.startDate,
            bookingForm.endDate,
            bookings,
          ),
        ),
      }))
      .filter((g) => g.rooms.length > 0)
  }, [
    roomsByCategoryForBooking,
    bookingForm.startDate,
    bookingForm.endDate,
    bookings,
  ])

  const roomsAvailableForEditBooking = useMemo(() => {
    const form = editBookingForm
    if (!form) return rooms
    const { startDate, endDate, bookingId } = form
    const start = parseISO(startDate)
    const end = parseISO(endDate)
    const datesValid =
      !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start
    if (!datesValid) return rooms
    return rooms.filter((room) =>
      isRoomFreeForBookingRange(room.id, startDate, endDate, bookings, bookingId),
    )
  }, [
    editBookingForm?.bookingId,
    editBookingForm?.startDate,
    editBookingForm?.endDate,
    rooms,
    bookings,
  ])

  const uncleanedRooms = useMemo(() => {
    return rooms
      .filter((r) => r.cleaningStatus === 'dirty')
      .sort((a, b) => {
        const c = (a.category ?? '').localeCompare(b.category ?? '', 'ru')
        if (c !== 0) return c
        return a.name.localeCompare(b.name, 'ru')
      })
  }, [rooms])

  const guestIdsWithStickyNotes = useMemo(() => {
    const s = new Set<string>()
    for (const n of stickyNotes) {
      if (n.guestId) s.add(n.guestId)
    }
    return s
  }, [stickyNotes])

  useEffect(() => {
    if (searchParams.get('newBooking') !== '1') return
    setBookingError('')
    setBookingForm(emptyNewBookingForm('', bookingSources, citizenships))
    setIsBookingModalOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('newBooking')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, bookingSources, citizenships])

  useEffect(() => {
    if (!isBookingModalOpen) return
    const ids = roomsAvailableForNewBooking.flatMap((g) => g.rooms.map((r) => r.id))
    if (ids.length === 0) {
      setBookingForm((prev) => (prev.roomId ? { ...prev, roomId: '' } : prev))
      return
    }
    setBookingForm((prev) =>
      ids.includes(prev.roomId) ? prev : { ...prev, roomId: ids[0]! },
    )
  }, [isBookingModalOpen, roomsAvailableForNewBooking])

  useEffect(() => {
    if (!editBookingOpen) return
    const ids = roomsAvailableForEditBooking.map((r) => r.id)
    if (ids.length === 0) {
      setEditBookingForm((prev) =>
        prev && prev.roomId ? { ...prev, roomId: '' } : prev,
      )
      return
    }
    setEditBookingForm((prev) => {
      if (!prev) return prev
      return ids.includes(prev.roomId) ? prev : { ...prev, roomId: ids[0]! }
    })
  }, [editBookingOpen, roomsAvailableForEditBooking])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadError('')
      try {
        const [r, b, g] = await Promise.all([fetchRooms(), fetchBookings(), fetchGuests()])
        const [cit, src] = await Promise.all([
          fetchCitizenships().catch(() => [] as Citizenship[]),
          fetchBookingSources().catch(() => [] as BookingSource[]),
        ])
        if (cancelled) return
        setRooms(r)
        setBookings(b)
        setGuests(g)
        setCitizenships(cit)
        setBookingSources(src)
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить данные.')
        }
      } finally {
        if (!cancelled) setDataReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsub = subscribeRoomsRealtime(() => {
      void fetchRooms()
        .then(setRooms)
        .catch(() => {
          /* оставляем текущий список номеров */
        })
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!conciergeOps || !dataReady) return
    let cancelled = false
    void fetchStickyNotes()
      .then((list) => {
        if (!cancelled) {
          setStickyNotes(list)
          setStickyNotesLoadError('')
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setStickyNotesLoadError(
            e instanceof Error ? e.message : 'Не удалось загрузить заметки.',
          )
        }
      })
    const unsub = subscribeNotesRealtime(() => {
      void fetchStickyNotes()
        .then((list) => {
          if (!cancelled) {
            setStickyNotes(list)
            setStickyNotesLoadError('')
          }
        })
        .catch(() => {
          /* оставляем текущий список заметок */
        })
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [conciergeOps, dataReady])

  useEffect(() => {
    if (rooms.length === 0) return
    const firstId = rooms[0]!.id
    setBookingForm((prev) => (prev.roomId ? prev : { ...prev, roomId: firstId }))
  }, [rooms])

  useEffect(() => {
    if (bookingSources.length === 0) return
    setBookingForm((prev) =>
      prev.bookingSourceId
        ? prev
        : { ...prev, bookingSourceId: defaultBookingSourceIdForForm(bookingSources) },
    )
  }, [bookingSources])

  async function handleCreateBooking() {
    setBookingError('')
    const start = parseISO(bookingForm.startDate)
    const end = parseISO(bookingForm.endDate)

    if (!bookingForm.roomId) {
      setBookingError('Выберите комнату.')
      return
    }

    const fn = bookingForm.firstName.trim()
    const ln = bookingForm.lastName.trim()
    if (!fn || !ln) {
      setBookingError('Укажите имя и фамилию гостя.')
      return
    }

    if (bookingSources.length > 0 && !bookingForm.bookingSourceId) {
      setBookingError('Выберите источник брони.')
      return
    }

    const srcId = bookingForm.bookingSourceId
      ? Number.parseInt(bookingForm.bookingSourceId, 10)
      : NaN
    if (bookingSources.length > 0 && !Number.isFinite(srcId)) {
      setBookingError('Выберите источник брони.')
      return
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      setBookingError('Проверьте даты брони.')
      return
    }

    if (
      !isRoomFreeForBookingRange(
        bookingForm.roomId,
        bookingForm.startDate,
        bookingForm.endDate,
        bookings,
      )
    ) {
      setBookingError('На выбранные даты для этой комнаты уже есть бронь.')
      return
    }

    const guestId = crypto.randomUUID()
    const middle = bookingForm.middleName.trim()
    const guestNameForBooking = buildGuestDisplayName(ln, fn, middle)

    const citizenshipRaw = bookingForm.citizenshipId.trim()
    const citizenshipIdNum = citizenshipRaw
      ? Number.parseInt(citizenshipRaw, 10)
      : NaN
    const citizenshipId = Number.isFinite(citizenshipIdNum) ? citizenshipIdNum : null

    const newGuest: Guest = {
      id: guestId,
      firstName: fn,
      lastName: ln,
      middleName: middle || null,
      citizenshipId,
      phone: bookingForm.phone.trim() || null,
      email: bookingForm.email.trim() || null,
      roomId: bookingForm.roomId,
      startDate: bookingForm.startDate,
      endDate: bookingForm.endDate,
      createdAt: new Date().toISOString(),
      paymentMethod: 'unpaid',
      aprove: false,
      checkedInAt: null,
      checkedOutAt: null,
    }

    const cit = normalizeCheckInTime(bookingForm.checkInTime)
    const cot = normalizeCheckInTime(bookingForm.checkOutTime)
    const newBooking: Booking = {
      id: crypto.randomUUID(),
      roomId: bookingForm.roomId,
      guestName: guestNameForBooking,
      startDate: bookingForm.startDate,
      endDate: bookingForm.endDate,
      checkInTime: cit && cit !== '00:00' ? cit : undefined,
      checkOutTime: cot && cot !== '00:00' ? cot : undefined,
      note: bookingForm.note.trim() || undefined,
      guestId,
      bookingSourceId: bookingSources.length > 0 ? srcId : null,
    }

    const nextGuests = [...guests, newGuest]
    const nextBookings = [...bookings, newBooking]
    try {
      await syncGuestsAndBookings(nextGuests, nextBookings)
    } catch {
      setBookingError('Не удалось сохранить бронь и гостя.')
      return
    }
    setGuests(nextGuests)
    setBookings(nextBookings)
    setIsBookingModalOpen(false)
  }

  const openNewBookingFromGrid = useCallback(
    (params: { roomId: string; startDate: string; endDate: string }) => {
      setBookingError('')
      skipNewBookingOpenResetRef.current = true
      setBookingForm({
        ...emptyNewBookingForm(params.roomId, bookingSources, citizenships),
        startDate: params.startDate,
        endDate: params.endDate,
      })
      setIsBookingModalOpen(true)
    },
    [bookingSources, citizenships],
  )

  async function persistRoomCleaningFromGrid(roomId: string, resolved: RoomCleaningStatus | null) {
    const prevRooms = rooms
    setRoomCleaningSaveError('')
    setRooms((list) => list.map((r) => (r.id === roomId ? { ...r, cleaningStatus: resolved } : r)))
    setRoomCleaningSavingRoomId(roomId)
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
      setRoomCleaningSaveError(
        e instanceof Error ? e.message : 'Не удалось сохранить статус уборки.',
      )
    } finally {
      setRoomCleaningSavingRoomId(null)
    }
  }

  function cycleRoomCleaningFromGrid(roomId: string) {
    const current = rooms.find((r) => r.id === roomId)?.cleaningStatus ?? null
    void persistRoomCleaningFromGrid(roomId, nextRoomCleaningStatusInCycle(current))
  }

  function parseNameFromBooking(booking: Booking, linked?: Guest) {
    if (linked) {
      return {
        firstName: linked.firstName,
        lastName: linked.lastName,
        middleName: (linked.middleName ?? '').trim(),
      }
    }
    return parseGuestNameFromLabel(booking.guestName)
  }

  const openBookingGuestDialog = useCallback(
    (booking: Booking) => {
      const linked = booking.guestId ? guests.find((g) => g.id === booking.guestId) : undefined
      const { firstName, lastName, middleName } = parseNameFromBooking(booking, linked)
      const citizenshipId =
        linked?.citizenshipId != null ? String(linked.citizenshipId) : ''
      const bookingSourceId =
        booking.bookingSourceId != null ? String(booking.bookingSourceId) : ''
      setEditBookingError('')
      setEditBookingForm({
        bookingId: booking.id,
        roomId: booking.roomId,
        firstName,
        lastName,
        middleName,
        citizenshipId,
        phone: linked?.phone ?? '',
        email: linked?.email ?? '',
        bookingSourceId:
          bookingSourceId ||
          (bookingSources.length > 0 ? defaultBookingSourceIdForForm(bookingSources) : ''),
        startDate: booking.startDate,
        checkInTime: checkInTimeForTimeInput(booking.checkInTime),
        checkOutTime: checkOutTimeForTimeInput(booking.checkOutTime),
        endDate: booking.endDate,
      })
      setEditBookingOpen(true)
    },
    [guests, bookingSources],
  )

  const handlePersistBookingGuest = useCallback(
    (setAprove: boolean) => {
      setEditBookingError('')
      if (!editBookingForm) return
      const {
        bookingId,
        roomId,
        firstName,
        lastName,
        middleName,
        citizenshipId: citizenshipIdStr,
        phone,
        email,
        bookingSourceId: bookingSourceIdStr,
        startDate,
        checkInTime,
        checkOutTime,
        endDate,
      } = editBookingForm
      const fn = firstName.trim()
      const ln = lastName.trim()
      const mid = middleName.trim()
      if (!fn || !ln) {
        setEditBookingError('Укажите имя и фамилию.')
        return
      }

      const b = bookings.find((x) => x.id === bookingId)
      if (!b) return

      const start = parseISO(startDate)
      const end = parseISO(endDate)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        setEditBookingError('Проверьте даты: выезд не раньше заезда.')
        return
      }

      if (
        !isRoomFreeForBookingRange(roomId, startDate, endDate, bookings, bookingId)
      ) {
        setEditBookingError('На эти даты в выбранном номере уже есть другая бронь.')
        return
      }

      const citizenshipNum = citizenshipIdStr.trim()
        ? Number.parseInt(citizenshipIdStr, 10)
        : NaN
      const citizenshipId = Number.isFinite(citizenshipNum) ? citizenshipNum : null

      const srcNum = bookingSourceIdStr.trim()
        ? Number.parseInt(bookingSourceIdStr, 10)
        : NaN
      const bookingSourceId = Number.isFinite(srcNum) ? srcNum : null

      const guestName = buildGuestDisplayName(ln, fn, mid)
      const cit = normalizeCheckInTime(checkInTime)
      const cot = normalizeCheckInTime(checkOutTime)
      const bookingCheckInTime = cit && cit !== '00:00' ? cit : undefined
      const bookingCheckOutTime = cot && cot !== '00:00' ? cot : undefined
      let guestId = b.guestId
      const nextGuests = [...guests]

      if (guestId) {
        const gi = nextGuests.findIndex((g) => g.id === guestId)
        if (gi >= 0) {
          nextGuests[gi] = {
            ...nextGuests[gi],
            firstName: fn,
            lastName: ln,
            middleName: mid || null,
            citizenshipId,
            phone: phone.trim() || null,
            email: email.trim() || null,
            roomId,
            startDate,
            endDate,
            aprove: setAprove ? true : nextGuests[gi].aprove,
            checkedInAt: setAprove
              ? (nextGuests[gi].checkedInAt ?? new Date().toISOString())
              : (nextGuests[gi].checkedInAt ?? null),
            checkedOutAt: nextGuests[gi].checkedOutAt ?? null,
          }
        } else {
          guestId = undefined
        }
      }

      if (!guestId) {
        const g: Guest = {
          id: crypto.randomUUID(),
          firstName: fn,
          lastName: ln,
          middleName: mid || null,
          citizenshipId,
          phone: phone.trim() || null,
          email: email.trim() || null,
          roomId,
          startDate,
          endDate,
          createdAt: new Date().toISOString(),
          paymentMethod: 'unpaid',
          aprove: setAprove,
          checkedInAt: setAprove ? new Date().toISOString() : null,
          checkedOutAt: null,
        }
        nextGuests.push(g)
        guestId = g.id
      }

      const nextBookings = bookings.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              roomId,
              guestName,
              guestId,
              startDate,
              endDate,
              checkInTime: bookingCheckInTime,
              checkOutTime: bookingCheckOutTime,
              bookingSourceId,
            }
          : booking,
      )

      void (async () => {
        try {
          await syncGuestsAndBookings(nextGuests, nextBookings)
        } catch {
          setEditBookingError('Не удалось сохранить данные в Supabase.')
          return
        }
        setGuests(nextGuests)
        setBookings(nextBookings)
        setEditBookingOpen(false)
        setEditBookingForm(null)
      })()
    },
    [bookings, guests, editBookingForm],
  )

  const handleGuestCheckedOut = useCallback(() => {
    setEditBookingError('')
    if (!editBookingForm) return
    const fn = editBookingForm.firstName.trim()
    const ln = editBookingForm.lastName.trim()
    if (!fn || !ln) {
      setEditBookingError('Укажите имя и фамилию.')
      return
    }
    const b = bookings.find((x) => x.id === editBookingForm.bookingId)
    if (!b) return
    if (!b.guestId) {
      setEditBookingError(
        'Сначала нажмите «Сохранить» или «Подтвердить заезд», чтобы карточка гостя попала в список.',
      )
      return
    }
    const guestRow = guests.find((g) => g.id === b.guestId)
    if (!guestRow) return
    if (guestRow.checkedOutAt) {
      setEditBookingError('Выезд этого гостя уже отмечен.')
      return
    }

    if (
      !window.confirm(
        'Подтвердить выезд? Карточка гостя останется в списке. Даты брони будут скорректированы, номер получит статус «не убран».',
      )
    ) {
      return
    }

    const startDate = editBookingForm.startDate
    const scheduledEnd = editBookingForm.endDate
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    const yesterdayKey = format(subDays(parseISO(`${todayKey}T12:00:00`), 1), 'yyyy-MM-dd')

    let newEndDate: string
    if (scheduledEnd <= yesterdayKey) {
      newEndDate = scheduledEnd
    } else {
      newEndDate = yesterdayKey >= startDate ? yesterdayKey : startDate
    }

    const start = parseISO(startDate)
    const end = parseISO(newEndDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      setEditBookingError('Не удалось скорректировать даты выезда.')
      return
    }

    const roomId = editBookingForm.roomId
    if (!isRoomFreeForBookingRange(roomId, startDate, newEndDate, bookings, b.id)) {
      setEditBookingError('На эти даты в выбранном номере уже есть другая бронь.')
      return
    }

    const checkedOutAt = new Date().toISOString()
    const guestName = buildGuestDisplayName(ln, fn, editBookingForm.middleName.trim())

    const nextGuests = guests.map((g) =>
      g.id === b.guestId
        ? {
            ...g,
            firstName: fn,
            lastName: ln,
            middleName: editBookingForm.middleName.trim() || null,
            roomId,
            startDate,
            endDate: newEndDate,
            checkedOutAt,
          }
        : g,
    )

    const nextBookings = bookings.map((booking) =>
      booking.id === b.id
        ? { ...booking, roomId, guestName, startDate, endDate: newEndDate }
        : booking,
    )

    void (async () => {
      try {
        await syncGuestsAndBookings(nextGuests, nextBookings)
        try {
          await updateRoomCleaningStatus(roomId, 'dirty')
          const r = await fetchRooms()
          setRooms(r)
        } catch {
          /* статус уборки / список номеров — не блокируем выезд */
        }
      } catch {
        setEditBookingError('Не удалось сохранить выезд в Supabase.')
        return
      }
      setGuests(nextGuests)
      setBookings(nextBookings)
      setEditBookingOpen(false)
      setEditBookingForm(null)
    })()
  }, [bookings, guests, editBookingForm])

  const handleCancelBooking = useCallback(() => {
    setEditBookingError('')
    if (!editBookingForm) return
    const bookingId = editBookingForm.bookingId
    const b = bookings.find((x) => x.id === bookingId)
    if (!b) return

    if (
      !window.confirm(
        'Отменить бронь? Запись о брони будет удалена. Карточка гостя в списке Guest останется.',
      )
    ) {
      return
    }

    const nextBookings = bookings.filter((x) => x.id !== bookingId)

    void (async () => {
      try {
        await syncBookings(nextBookings)
      } catch {
        setEditBookingError('Не удалось сохранить изменения.')
        return
      }
      setBookings(nextBookings)
      setEditBookingOpen(false)
      setEditBookingForm(null)
    })()
  }, [bookings, editBookingForm])

  const applyBookingDatesChange = useCallback(
    (bookingId: string, next: { startDate: string; endDate: string }) => {
      const start = parseISO(next.startDate)
      const end = parseISO(next.endDate)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return false
      const target = bookings.find((b) => b.id === bookingId)
      if (!target) return false
      const hasOverlap = bookings.some((booking) => {
        if (booking.id === bookingId || booking.roomId !== target.roomId) return false
        const es = parseISO(booking.startDate)
        const ee = parseISO(booking.endDate)
        return start <= ee && end >= es
      })
      if (hasOverlap) return false
      const nextBookings = bookings.map((b) =>
        b.id === bookingId ? { ...b, startDate: next.startDate, endDate: next.endDate } : b,
      )
      const nextGuests = target.guestId
        ? guests.map((g) =>
            g.id === target.guestId
              ? { ...g, startDate: next.startDate, endDate: next.endDate }
              : g,
          )
        : guests

      void (async () => {
        try {
          await syncBookings(nextBookings)
          if (target.guestId) await syncGuests(nextGuests)
        } catch {
          try {
            const [fb, fg] = await Promise.all([fetchBookings(), fetchGuests()])
            setBookings(fb)
            setGuests(fg)
          } catch {
            /* ignore */
          }
          return
        }
        setBookings(nextBookings)
        if (target.guestId) setGuests(nextGuests)
      })()
      return true
    },
    [bookings, guests],
  )

  return (
    <>
      {conciergeOps ? (
        <div
          className="pointer-events-none fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[calc(max(0.75rem,env(safe-area-inset-top,0px))+3rem)] z-[45]"
        >
          <div className="pointer-events-auto">
            <Dialog
              open={isBookingModalOpen}
              onOpenChange={(open) => {
                setIsBookingModalOpen(open)
                if (open) {
                  if (skipNewBookingOpenResetRef.current) {
                    skipNewBookingOpenResetRef.current = false
                  } else {
                    setBookingError('')
                    setBookingForm(emptyNewBookingForm('', bookingSources, citizenships))
                  }
                } else {
                  setBookingError('')
                }
              }}
            >
              <DialogTrigger asChild>
                <Button className="shrink-0 shadow-sm">Добавить бронь</Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая бронь</DialogTitle>
                <DialogDescription>
                  Карточка гостя создаётся автоматически и попадает в список гостей. Фамилия и имя обязательны;
                  гражданство и источник брони — из справочников в базе. Дата и время заезда / выезда — в одной
                  строке с каждой датой.
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-w-0 gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="room">Комната</Label>
                  <select
                    id="room"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={bookingForm.roomId}
                    onChange={(event) =>
                      setBookingForm((prev) => ({ ...prev, roomId: event.target.value }))
                    }
                  >
                    {roomsAvailableForNewBooking.length === 0 ? (
                      <option value="" disabled>
                        Нет свободных номеров на эти даты
                      </option>
                    ) : (
                      roomsAvailableForNewBooking.map(({ category, rooms: catRooms }) => (
                        <optgroup key={category} label={category}>
                          {catRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name} (вместимость: {room.capacity}) · {category}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="bkLastName">Фамилия</Label>
                    <Input
                      id="bkLastName"
                      value={bookingForm.lastName}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, lastName: event.target.value }))
                      }
                      autoComplete="family-name"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bkFirstName">Имя</Label>
                    <Input
                      id="bkFirstName"
                      value={bookingForm.firstName}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, firstName: event.target.value }))
                      }
                      autoComplete="given-name"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bkMiddleName">Отчество</Label>
                  <Input
                    id="bkMiddleName"
                    value={bookingForm.middleName}
                    onChange={(event) =>
                      setBookingForm((prev) => ({ ...prev, middleName: event.target.value }))
                    }
                    autoComplete="additional-name"
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="bkCitizenship">Гражданство</Label>
                    <CitizenshipSelect
                      id="bkCitizenship"
                      className="w-full min-w-0 max-w-full"
                      value={bookingForm.citizenshipId}
                      onChange={(v) =>
                        setBookingForm((prev) => ({ ...prev, citizenshipId: v }))
                      }
                      citizenships={citizenships}
                    />
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="bkBookingSource">Источник брони</Label>
                    <select
                      id="bkBookingSource"
                      className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bookingForm.bookingSourceId}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, bookingSourceId: event.target.value }))
                      }
                      disabled={bookingSources.length === 0}
                    >
                      {bookingSources.length === 0 ? (
                        <option value="">Примените миграции БД</option>
                      ) : (
                        bookingSources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="bkPhone">Телефон</Label>
                    <Input
                      id="bkPhone"
                      type="tel"
                      inputMode="tel"
                      value={bookingForm.phone}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, phone: event.target.value }))
                      }
                      autoComplete="tel"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bkEmail">Электронная почта</Label>
                    <Input
                      id="bkEmail"
                      type="email"
                      inputMode="email"
                      value={bookingForm.email}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, email: event.target.value }))
                      }
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="startDate">Заезд</Label>
                    <div className="flex min-w-0 gap-2">
                      <Input
                        id="startDate"
                        type="date"
                        className="min-w-0 flex-1"
                        value={bookingForm.startDate}
                        onChange={(event) =>
                          setBookingForm((prev) => ({ ...prev, startDate: event.target.value }))
                        }
                      />
                      <Input
                        id="bookingCheckInTime"
                        type="time"
                        step={60}
                        className="w-[7.25rem] shrink-0 sm:w-32"
                        value={bookingForm.checkInTime}
                        onChange={(event) =>
                          setBookingForm((prev) => ({ ...prev, checkInTime: event.target.value }))
                        }
                        aria-label="Время заезда"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="endDate">Выезд</Label>
                    <div className="flex min-w-0 gap-2">
                      <Input
                        id="endDate"
                        type="date"
                        className="min-w-0 flex-1"
                        value={bookingForm.endDate}
                        onChange={(event) =>
                          setBookingForm((prev) => ({ ...prev, endDate: event.target.value }))
                        }
                      />
                      <Input
                        id="bookingCheckOutTime"
                        type="time"
                        step={60}
                        className="w-[7.25rem] shrink-0 sm:w-32"
                        value={bookingForm.checkOutTime}
                        onChange={(event) =>
                          setBookingForm((prev) => ({ ...prev, checkOutTime: event.target.value }))
                        }
                        aria-label="Время выезда"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Время относится к тому же дню. 00:00 заезд — с полуночи; 00:00 выезд — до конца суток даты
                  выезда.
                </p>

                <div className="grid gap-2">
                  <Label htmlFor="note">Комментарий</Label>
                  <Input
                    id="note"
                    value={bookingForm.note}
                    onChange={(event) =>
                      setBookingForm((prev) => ({ ...prev, note: event.target.value }))
                    }
                    placeholder="Опционально"
                  />
                </div>

                {bookingError ? <p className="text-sm text-red-600">{bookingError}</p> : null}
                <Button onClick={handleCreateBooking}>Сохранить бронь</Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-6 p-6">
        <header className="flex min-w-0 w-full shrink-0 flex-col gap-4">
          {housekeeperOnly ? (
            <p className="text-sm text-muted-foreground">
              Список номеров со статусом «не убрано». Полная отметка уборки — в разделе «Уборка в номерах».
            </p>
          ) : null}
          {loadError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {loadError}
            </p>
          ) : null}
          {!dataReady && !loadError ? (
            <p className="text-sm text-muted-foreground">Загрузка данных из Supabase…</p>
          ) : null}
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {conciergeOps ? (
            <>
              <h2 className="mb-2 shrink-0 text-lg font-semibold tracking-tight">Шахматка броней</h2>
              {roomCleaningSaveError ? (
                <p className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-400">
                  {roomCleaningSaveError}
                </p>
              ) : null}
            </>
          ) : housekeeperOnly ? (
            <h2 className="mb-2 shrink-0 text-lg font-semibold tracking-tight">Неубранные номера</h2>
          ) : null}
          {housekeeperOnly ? (
            <section
              className="mb-4 flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-muted/20 p-4 shadow-sm dark:bg-card/50"
              aria-label="Номера со статусом не убрано"
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Отметьте уборку на странице «Уборка в номерах».
                </p>
                <Link
                  to="/room-cleaning"
                  className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
                >
                  Уборка в номерах
                </Link>
              </div>
              {uncleanedRooms.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Нет номеров со статусом «не убрано».
                </p>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-wrap content-start gap-3 overflow-y-auto">
                  {uncleanedRooms.map((room) => {
                    const next = findNextCheckInForRoom(room.id, bookings)
                    const urgent = next ? checkInUrgentWithinTwoHours(next.at) : false
                    const hoverTitle = next
                      ? formatNextCheckInHoverTitle(next.at)
                      : `${room.name}${room.category ? ` · ${room.category}` : ''}. Нет предстоящего заезда по брони`
                    return (
                      <li key={room.id} className="max-w-[12rem] list-none">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'cursor-default rounded-md border border-red-200/90 bg-red-50 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-red-900/55 dark:bg-red-950/35',
                                urgent &&
                                  'border-2 border-amber-500 ring-2 ring-amber-500/90 dark:border-amber-400 dark:ring-amber-400/80',
                              )}
                              tabIndex={0}
                            >
                              <div className="flex items-start gap-1.5">
                                {urgent ? (
                                  <span
                                    className="mt-0.5 shrink-0 rounded-sm bg-amber-500 px-1 text-xs font-bold leading-none text-white shadow-sm dark:bg-amber-400 dark:text-amber-950"
                                    aria-hidden
                                  >
                                    !
                                  </span>
                                ) : null}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium leading-tight text-red-950 dark:text-red-50">
                                    {room.name}
                                  </p>
                                  {room.category ? (
                                    <p className="truncate text-xs leading-tight text-red-900/75 dark:text-red-200/80">
                                      {room.category}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="whitespace-normal">
                            {hoverTitle}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ) : (
            <>
              {conciergeOps ? (
                <StickyNotesBoard
                  notes={stickyNotes}
                  setNotes={setStickyNotes}
                  rooms={rooms}
                  guests={guests}
                  loadError={stickyNotesLoadError}
                />
              ) : null}
              <div
                className={cn(
                  'mb-4 grid min-w-0 shrink-0 gap-3 sm:gap-4',
                  admin ? 'grid-cols-2' : 'grid-cols-1',
                )}
              >
                <div className="min-h-0 min-w-0">
                  <OccupancyTodaySummary
                    className="h-full min-h-0"
                    rooms={rooms}
                    bookings={bookings}
                    guests={guests}
                  />
                </div>
                {admin ? (
                  <section
                    className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-muted/20 p-3 shadow-sm dark:bg-card/50 sm:p-4"
                    aria-label="Номера со статусом не убрано"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">Неубранные номера</h3>
                      <Link
                        to="/room-cleaning"
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'h-auto border-transparent bg-transparent py-0 text-xs text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        Уборка в номерах
                      </Link>
                    </div>
                    {uncleanedRooms.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Нет номеров со статусом «не убрано» — либо всё отмечено как убрано, либо отметок ещё
                        не было.
                      </p>
                    ) : (
                      <ul className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto">
                        {uncleanedRooms.map((room) => {
                          const next = findNextCheckInForRoom(room.id, bookings)
                          const urgent = next ? checkInUrgentWithinTwoHours(next.at) : false
                          const hoverTitle = next
                            ? formatNextCheckInHoverTitle(next.at)
                            : `${room.name}${room.category ? ` · ${room.category}` : ''}. Нет предстоящего заезда по брони`
                          return (
                            <li key={room.id} className="max-w-[10rem] list-none">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={cn(
                                      'cursor-default rounded-md border border-red-200/90 bg-red-50 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-red-900/55 dark:bg-red-950/35',
                                      urgent &&
                                        'border-2 border-amber-500 ring-2 ring-amber-500/90 dark:border-amber-400 dark:ring-amber-400/80',
                                    )}
                                    tabIndex={0}
                                  >
                                    <div className="flex items-start gap-1">
                                      {urgent ? (
                                        <span
                                          className="mt-0.5 shrink-0 rounded-sm bg-amber-500 px-0.5 text-[10px] font-bold leading-none text-white dark:bg-amber-400 dark:text-amber-950"
                                          aria-hidden
                                        >
                                          !
                                        </span>
                                      ) : null}
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium leading-tight text-red-950 dark:text-red-50">
                                          {room.name}
                                        </p>
                                        {room.category ? (
                                          <p className="truncate text-[10px] leading-tight text-red-900/75 dark:text-red-200/80">
                                            {room.category}
                                          </p>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="whitespace-normal">
                                  {hoverTitle}
                                </TooltipContent>
                              </Tooltip>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                ) : null}
              </div>
              <BookingShakhmatka
                rooms={rooms}
                bookings={bookings}
                guests={guests}
                onNewBookingRequest={openNewBookingFromGrid}
                onBookingDatesChange={applyBookingDatesChange}
                onBookingEditClick={openBookingGuestDialog}
                onRoomCleaningStatusClick={
                  canEditRoomCleaningFromGrid ? cycleRoomCleaningFromGrid : undefined
                }
                roomCleaningSavingRoomId={roomCleaningSavingRoomId}
                guestIdsWithStickyNotes={guestIdsWithStickyNotes}
              />
            </>
          )}
        </div>
      </div>

      <Dialog
        open={editBookingOpen}
        onOpenChange={(open) => {
          setEditBookingOpen(open)
          if (!open) {
            setEditBookingForm(null)
            setEditBookingError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Бронь и гость</DialogTitle>
            <DialogDescription>
              Номер, даты с временем заезда и выезда, ФИО, контакты и источник брони сохраняются в брони и в
              таблице Guest. «Подтвердить заезд» записывает признак в столбец aprove. «Гость выехал» фиксирует
              выезд, карточка гостя остаётся в списке навсегда.
            </DialogDescription>
          </DialogHeader>
          {editBookingForm ? (
            <div className="grid min-w-0 gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="editBkRoom">Номер</Label>
                <select
                  id="editBkRoom"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={editBookingForm.roomId}
                  onChange={(e) =>
                    setEditBookingForm((prev) =>
                      prev ? { ...prev, roomId: e.target.value } : prev,
                    )
                  }
                >
                  {roomsAvailableForEditBooking.length === 0 ? (
                    <option value="" disabled>
                      Нет свободных номеров на эти даты
                    </option>
                  ) : (
                    roomsAvailableForEditBooking.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="editBkStart">Заезд</Label>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      ref={editWheelStartDateRef}
                      id="editBkStart"
                      type="date"
                      className="min-w-0 flex-1"
                      value={editBookingForm.startDate}
                      onChange={(e) =>
                        setEditBookingForm((prev) =>
                          prev ? { ...prev, startDate: e.target.value } : prev,
                        )
                      }
                    />
                    <Input
                      ref={editWheelCheckInRef}
                      id="editBkCheckInTime"
                      type="time"
                      step={60}
                      className="w-[7.25rem] shrink-0 sm:w-32"
                      value={editBookingForm.checkInTime}
                      onChange={(e) =>
                        setEditBookingForm((prev) =>
                          prev ? { ...prev, checkInTime: e.target.value } : prev,
                        )
                      }
                      aria-label="Время заезда"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editBkEnd">Выезд</Label>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      ref={editWheelEndDateRef}
                      id="editBkEnd"
                      type="date"
                      className="min-w-0 flex-1"
                      value={editBookingForm.endDate}
                      onChange={(e) =>
                        setEditBookingForm((prev) =>
                          prev ? { ...prev, endDate: e.target.value } : prev,
                        )
                      }
                    />
                    <Input
                      ref={editWheelCheckOutRef}
                      id="editBkCheckOutTime"
                      type="time"
                      step={60}
                      className="w-[7.25rem] shrink-0 sm:w-32"
                      value={editBookingForm.checkOutTime}
                      onChange={(e) =>
                        setEditBookingForm((prev) =>
                          prev ? { ...prev, checkOutTime: e.target.value } : prev,
                        )
                      }
                      aria-label="Время выезда"
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Время на шахматке: тот же день, что и дата. 00:00 заезд — с полуночи; 00:00 выезд — до конца
                суток. При фокусе в поле колёсико мыши меняет дату (±1 день) или время (±15 мин).
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="editBkLastName">Фамилия</Label>
                  <Input
                    id="editBkLastName"
                    value={editBookingForm.lastName}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, lastName: e.target.value } : prev,
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editBkFirstName">Имя</Label>
                  <Input
                    id="editBkFirstName"
                    value={editBookingForm.firstName}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, firstName: e.target.value } : prev,
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editBkMiddleName">Отчество</Label>
                <Input
                  id="editBkMiddleName"
                  value={editBookingForm.middleName}
                  onChange={(e) =>
                    setEditBookingForm((prev) =>
                      prev ? { ...prev, middleName: e.target.value } : prev,
                    )
                  }
                />
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="editBkCitizenship">Гражданство</Label>
                  <CitizenshipSelect
                    id="editBkCitizenship"
                    className="w-full min-w-0 max-w-full"
                    value={editBookingForm.citizenshipId}
                    onChange={(v) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, citizenshipId: v } : prev,
                      )
                    }
                    citizenships={citizenships}
                  />
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="editBkBookingSource">Источник брони</Label>
                  <select
                    id="editBkBookingSource"
                    className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={editBookingForm.bookingSourceId}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, bookingSourceId: e.target.value } : prev,
                      )
                    }
                    disabled={bookingSources.length === 0}
                  >
                    <option value="">Не указано</option>
                    {bookingSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="editBkPhone">Телефон</Label>
                  <Input
                    id="editBkPhone"
                    type="tel"
                    value={editBookingForm.phone}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, phone: e.target.value } : prev,
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editBkEmail">Электронная почта</Label>
                  <Input
                    id="editBkEmail"
                    type="email"
                    value={editBookingForm.email}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, email: e.target.value } : prev,
                      )
                    }
                  />
                </div>
              </div>
              {(() => {
                const bid = editBookingForm.bookingId
                const gid = bookings.find((x) => x.id === bid)?.guestId
                const gCard = gid ? guests.find((x) => x.id === gid) : undefined
                return gid ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      <Link className="underline" to={`/guest/${gid}`}>
                        Открыть карточку гостя
                      </Link>
                    </p>
                    {gCard?.checkedOutAt ? (
                      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                        Выезд отмечен{' '}
                        {format(parseISO(gCard.checkedOutAt), 'dd.MM.yyyy HH:mm')}
                      </p>
                    ) : null}
                  </div>
                ) : null
              })()}
              {editBookingError ? (
                <p className="text-sm text-red-600">{editBookingError}</p>
              ) : null}
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-200 bg-amber-50/80 text-amber-950 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-50 dark:hover:bg-amber-950/50"
                  onClick={handleGuestCheckedOut}
                  disabled={(() => {
                    const bk = bookings.find((x) => x.id === editBookingForm.bookingId)
                    if (!bk?.guestId) return true
                    return Boolean(guests.find((g) => g.id === bk.guestId)?.checkedOutAt)
                  })()}
                >
                  Гость выехал
                </Button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                    onClick={handleCancelBooking}
                  >
                    Отменить бронь
                  </Button>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {(() => {
                      const bk = bookings.find((x) => x.id === editBookingForm.bookingId)
                      if (!bk || isBookingGuestCheckInApproved(bk, guests)) return null
                      return (
                        <Button type="button" onClick={() => handlePersistBookingGuest(true)}>
                          Подтвердить заезд
                        </Button>
                      )
                    })()}
                    <Button type="button" variant="outline" onClick={() => handlePersistBookingGuest(false)}>
                      Сохранить
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default HomePage
