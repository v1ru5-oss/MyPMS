import { addDays, eachDayOfInterval, format, parseISO, subDays } from 'date-fns'
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
import {
  doesRoomClosureOverlapRange,
  isRoomFreeForBookingRange,
} from '@/lib/room-booking-availability'
import { nextRoomCleaningStatusInCycle } from '@/lib/room-cleaning-cycle'
import {
  fetchAdditionalServices,
  fetchBookingAdditionalServices,
  fetchBookingSubGuests,
  fetchBookingSources,
  fetchBookings,
  fetchCitizenships,
  fetchGuests,
  fetchGuestProfiles,
  fetchRoomDailyPrices,
  fetchRoomClosures,
  fetchRoomSpecialPriceConditions,
  fetchRooms,
  fetchStickyNotes,
  subscribeNotesRealtime,
  subscribeRoomClosuresRealtime,
  subscribeRoomsRealtime,
  syncBookings,
  syncGuests,
  syncGuestsAndBookings,
  upsertGuestProfile,
  updateRoomCleaningStatus,
  setBookingAdditionalServices,
  setRoomClosures as setRoomClosuresInDb,
  setBookingSubGuests as setBookingSubGuestsInDb,
} from '@/lib/pms-db'
import { cn, randomUUID } from '@/lib/utils'
import {
  type Booking,
  type BookingAdditionalService,
  type BookingSubGuest,
  type BookingSource,
  type AdditionalService,
  type Citizenship,
  type DayOfWeek,
  type Guest,
  type GuestPaymentMethod,
  type GuestProfile,
  type PaymentStatus,
  type RoomDailyPrice,
  type RoomSpecialPriceCondition,
  type RoomClosure,
  type Room,
  type RoomCleaningStatus,
  type StickyNote,
} from '@/types/models'

function guestPaymentMethodFromForm(status: PaymentStatus, channel: 'cash' | 'transfer'): GuestPaymentMethod {
  return status === 'paid' ? channel : 'unpaid'
}

type NewBookingForm = {
  roomId: string
  guestProfileId: string
  citizenshipId: string
  phone: string
  email: string
  bookingSourceId: string
  guestsCount: string
  childrenCount: string
  startDate: string
  checkInTime: string
  checkOutTime: string
  endDate: string
  note: string
  paymentStatus: PaymentStatus
  paymentChannel: 'cash' | 'transfer'
}

type RoomDailyPricesMap = Record<string, Partial<Record<DayOfWeek, number>>>
type RoomSpecialConditionsMap = Record<string, RoomSpecialPriceCondition[]>
type RoomClosuresMap = Record<string, RoomClosure[]>
type BookingAdditionalServicesMap = Record<string, BookingAdditionalService[]>
type BookingSubGuestsMap = Record<string, BookingSubGuest[]>

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

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

function transliterateLastNameToLatin(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => CYRILLIC_TO_LATIN_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '')
}

function generateReadableProfileId(lastName: string, existingIds: ReadonlySet<string>): string {
  const base = transliterateLastNameToLatin(lastName) || 'guest'
  let index = 1
  let next = `${base}${index}`
  while (existingIds.has(next)) {
    index += 1
    next = `${base}${index}`
  }
  return next
}

function profileMatchesQuery(profile: GuestProfile, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return profile.id.toLowerCase().includes(q) || profile.lastName.toLowerCase().includes(q)
}

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

function emptyNewBookingForm(
  roomId: string,
  sources: BookingSource[],
  citizenships: Citizenship[],
): NewBookingForm {
  const today = format(new Date(), 'yyyy-MM-dd')
  return {
    roomId,
    guestProfileId: '',
    citizenshipId: defaultCitizenshipIdForForm(citizenships),
    phone: '',
    email: '',
    bookingSourceId: defaultBookingSourceIdForForm(sources),
    guestsCount: '1',
    childrenCount: '0',
    startDate: today,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    endDate: today,
    note: '',
    paymentStatus: 'unpaid',
    paymentChannel: 'cash',
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

function buildRoomDailyPricesMap(rows: RoomDailyPrice[]): RoomDailyPricesMap {
  const byRoomId: RoomDailyPricesMap = {}
  rows.forEach((row) => {
    byRoomId[row.roomId] ??= {}
    byRoomId[row.roomId][row.dayOfWeek] = row.price
  })
  return byRoomId
}

function calcBookingTotalPrice(
  roomId: string,
  startDate: string,
  endDate: string,
  pricesMap: RoomDailyPricesMap,
  specialConditionsMap: RoomSpecialConditionsMap,
): number {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  const roomPrices = pricesMap[roomId] ?? {}
  const roomConditions = specialConditionsMap[roomId] ?? []
  return eachDayOfInterval({ start, end }).reduce((sum, day) => {
    const dayOfWeek = day.getDay() as DayOfWeek
    const dayAnchor = parseISO(`${format(day, 'yyyy-MM-dd')}T12:00:00`)
    const specialPrice = roomConditions.reduce<number | null>((best, condition) => {
      const starts = parseISO(condition.startAt)
      const ends = parseISO(condition.endAt)
      if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return best
      if (dayAnchor < starts || dayAnchor > ends) return best
      const candidate = condition.prices[dayOfWeek]
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return best
      if (best == null) return candidate
      return Math.max(best, candidate)
    }, null)
    const dayPrice = specialPrice ?? roomPrices[dayOfWeek]
    return sum + (typeof dayPrice === 'number' && Number.isFinite(dayPrice) ? dayPrice : 0)
  }, 0)
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
  const [roomDailyPrices, setRoomDailyPrices] = useState<RoomDailyPricesMap>({})
  const [roomSpecialConditions, setRoomSpecialConditions] = useState<RoomSpecialConditionsMap>({})
  const [roomClosures, setRoomClosures] = useState<RoomClosuresMap>({})
  const [closureEditDialog, setClosureEditDialog] = useState<{
    roomId: string
    closureId: string
    startAt: string
    endAt: string
    reason: string
  } | null>(null)
  const [closureEditError, setClosureEditError] = useState('')
  const [isSavingClosureEdit, setIsSavingClosureEdit] = useState(false)
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
  const [guestProfiles, setGuestProfiles] = useState<GuestProfile[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [roomCleaningSaveError, setRoomCleaningSaveError] = useState('')
  const [roomCleaningSavingRoomId, setRoomCleaningSavingRoomId] = useState<string | null>(null)
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([])
  const [stickyNotesLoadError, setStickyNotesLoadError] = useState('')

  const [editBookingOpen, setEditBookingOpen] = useState(false)
  const [costTooltipOpen, setCostTooltipOpen] = useState<'base' | 'special' | null>(null)
  const [servicesDialogOpen, setServicesDialogOpen] = useState(false)
  const [newBookingServicesDialogOpen, setNewBookingServicesDialogOpen] = useState(false)
  const [availableAdditionalServices, setAvailableAdditionalServices] = useState<AdditionalService[]>([])
  const [bookingAdditionalServices, setBookingAdditionalServicesState] = useState<BookingAdditionalServicesMap>({})
  const [bookingSubGuests, setBookingSubGuestsState] = useState<BookingSubGuestsMap>({})
  const [editingAdditionalServices, setEditingAdditionalServices] = useState<
    Record<string, { checked: boolean; quantity: number; unitPrice: number }>
  >({})
  const [newBookingAdditionalServices, setNewBookingAdditionalServices] = useState<
    Record<string, { checked: boolean; quantity: number; unitPrice: number }>
  >({})
  const [newBookingSubGuestsDialogOpen, setNewBookingSubGuestsDialogOpen] = useState(false)
  const [newBookingSubGuests, setNewBookingSubGuests] = useState<
    Array<{
      id: string
      position: number
      lastName: string
      firstName: string
      middleName: string
      passportData: string
      isChild: boolean
      age: string
      birthCertificate: string
    }>
  >([])
  const [activeNewSubGuestId, setActiveNewSubGuestId] = useState<string | null>(null)
  const [newSubGuestsTemplateBookingId, setNewSubGuestsTemplateBookingId] = useState('')
  const [newBookingTemplateCapacityWarning, setNewBookingTemplateCapacityWarning] = useState('')
  const [newBookingTemplateRequiredGuests, setNewBookingTemplateRequiredGuests] = useState<number | null>(null)
  const [pendingTemplateProfileId, setPendingTemplateProfileId] = useState('')
  const [pendingTemplateBookingId, setPendingTemplateBookingId] = useState('')
  const [editBookingForm, setEditBookingForm] = useState<{
    bookingId: string
    roomId: string
    guestProfileId: string
    citizenshipId: string
    phone: string
    email: string
    bookingSourceId: string
    guestsCount: string
    childrenCount: string
    startDate: string
    checkInTime: string
    checkOutTime: string
    endDate: string
    paymentStatus: PaymentStatus
    paymentChannel: 'cash' | 'transfer'
  } | null>(null)
  const [editBookingError, setEditBookingError] = useState('')
  const [subGuestsDialogOpen, setSubGuestsDialogOpen] = useState(false)
  const [editingSubGuests, setEditingSubGuests] = useState<
    Array<{
      id: string
      position: number
      lastName: string
      firstName: string
      middleName: string
      passportData: string
      isChild: boolean
      age: string
      birthCertificate: string
    }>
  >([])
  const [activeSubGuestId, setActiveSubGuestId] = useState<string | null>(null)
  const [editSubGuestsTemplateBookingId, setEditSubGuestsTemplateBookingId] = useState('')

  const selectedNewBookingRoomCapacity = useMemo(() => {
    const room = rooms.find((x) => x.id === bookingForm.roomId)
    return Math.max(1, room?.capacity ?? 1)
  }, [rooms, bookingForm.roomId])
  const guestProfilesById = useMemo(
    () => new Map(guestProfiles.map((profile) => [profile.id, profile])),
    [guestProfiles],
  )
  const formatGuestProfileLabel = useCallback((profile: GuestProfile) => {
    const fio = [profile.lastName, profile.firstName, profile.middleName?.trim()]
      .filter(Boolean)
      .join(' ')
    return fio || profile.id
  }, [])
  const latestBookingByGuestId = useMemo(() => {
    const map = new Map<string, Booking>()
    bookings.forEach((booking) => {
      if (!booking.guestId) return
      const prev = map.get(booking.guestId)
      if (!prev || booking.startDate > prev.startDate) {
        map.set(booking.guestId, booking)
      }
    })
    return map
  }, [bookings])
  const newProfileSearchMatches = useMemo(() => {
    const q = bookingForm.guestProfileId.trim()
    if (!q) return [] as GuestProfile[]
    return guestProfiles
      .filter((profile) => profileMatchesQuery(profile, q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'ru'))
      .slice(0, 8)
  }, [guestProfiles, bookingForm.guestProfileId])
  const editProfileSearchMatches = useMemo(() => {
    const q = editBookingForm?.guestProfileId.trim() ?? ''
    if (!q) return [] as GuestProfile[]
    return guestProfiles
      .filter((profile) => profileMatchesQuery(profile, q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'ru'))
      .slice(0, 8)
  }, [guestProfiles, editBookingForm?.guestProfileId])

  const editBkWheelEnabled = editBookingOpen && editBookingForm !== null
  const editWheelStartDate = editBookingForm?.startDate ?? ''
  const editWheelEndDate = editBookingForm?.endDate ?? ''
  const editWheelCheckIn = editBookingForm?.checkInTime ?? '00:00'
  const editWheelCheckOut = editBookingForm?.checkOutTime ?? '12:00'

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
          ) &&
          !doesRoomClosureOverlapRange(
            room.id,
            bookingForm.startDate,
            bookingForm.endDate,
            roomClosures[room.id] ?? [],
            bookingForm.checkInTime,
            bookingForm.checkOutTime,
          ),
        ),
      }))
      .filter((g) => g.rooms.length > 0)
  }, [
    roomsByCategoryForBooking,
    bookingForm.startDate,
    bookingForm.endDate,
    bookings,
    roomClosures,
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
      isRoomFreeForBookingRange(room.id, startDate, endDate, bookings, bookingId) &&
      !doesRoomClosureOverlapRange(
        room.id,
        startDate,
        endDate,
        roomClosures[room.id] ?? [],
        form.checkInTime,
        form.checkOutTime,
      ),
    )
  }, [
    editBookingForm?.bookingId,
    editBookingForm?.startDate,
    editBookingForm?.endDate,
    editBookingForm?.checkInTime,
    editBookingForm?.checkOutTime,
    rooms,
    bookings,
    roomClosures,
  ])
  const suggestedRoomsForTemplate = useMemo(() => {
    if (!newBookingTemplateRequiredGuests) return [] as Room[]
    const flat = roomsAvailableForNewBooking.flatMap((group) => group.rooms)
    return flat
      .filter((room) => room.capacity >= newBookingTemplateRequiredGuests)
      .sort((a, b) => {
        const da = a.capacity - newBookingTemplateRequiredGuests
        const db = b.capacity - newBookingTemplateRequiredGuests
        if (da !== db) return da - db
        return a.name.localeCompare(b.name, 'ru')
      })
      .slice(0, 5)
  }, [roomsAvailableForNewBooking, newBookingTemplateRequiredGuests])

  const uncleanedRooms = useMemo(() => {
    return rooms
      .filter((r) => r.cleaningStatus === 'dirty')
      .sort((a, b) => {
        const c = (a.category ?? '').localeCompare(b.category ?? '', 'ru')
        if (c !== 0) return c
        return a.name.localeCompare(b.name, 'ru')
      })
  }, [rooms])

  const closedRoomsToday = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    return Object.values(roomClosures)
      .flat()
      .filter((closure) => {
        const startKey = format(parseISO(closure.startAt), 'yyyy-MM-dd')
        const endKey = format(parseISO(closure.endAt), 'yyyy-MM-dd')
        return todayKey >= startKey && todayKey <= endKey
      })
      .map((closure) => ({
        closure,
        room: rooms.find((room) => room.id === closure.roomId),
      }))
      .sort((a, b) => {
        const roomA = a.room?.name ?? a.closure.roomId
        const roomB = b.room?.name ?? b.closure.roomId
        return roomA.localeCompare(roomB, 'ru')
      })
  }, [roomClosures, rooms])

  const bookingSubGuestsFlat = useMemo(
    () => Object.values(bookingSubGuests).flat(),
    [bookingSubGuests],
  )

  const guestIdsWithStickyNotes = useMemo(() => {
    const s = new Set<string>()
    const bookingById = new Map(bookings.map((b) => [b.id, b] as const))
    for (const n of stickyNotes) {
      if (n.guestId) s.add(n.guestId)
      if (n.bookingSubGuestId) {
        const sg = bookingSubGuestsFlat.find((x) => x.id === n.bookingSubGuestId)
        const bk = sg ? bookingById.get(sg.bookingId) : undefined
        if (bk?.guestId) s.add(bk.guestId)
      }
    }
    return s
  }, [stickyNotes, bookings, bookingSubGuestsFlat])

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
        const [r, b, g, profiles, dailyPrices, specialConditions, closures, addServices, bookingServices, subGuests] =
          await Promise.all([
          fetchRooms(),
          fetchBookings(),
          fetchGuests(),
          fetchGuestProfiles().catch(() => [] as GuestProfile[]),
          fetchRoomDailyPrices().catch(() => [] as RoomDailyPrice[]),
          fetchRoomSpecialPriceConditions().catch(() => [] as RoomSpecialPriceCondition[]),
          fetchRoomClosures().catch(() => [] as RoomClosure[]),
          fetchAdditionalServices().catch(() => [] as AdditionalService[]),
          fetchBookingAdditionalServices().catch(() => [] as BookingAdditionalService[]),
          fetchBookingSubGuests().catch(() => [] as BookingSubGuest[]),
        ])
        const [cit, src] = await Promise.all([
          fetchCitizenships().catch(() => [] as Citizenship[]),
          fetchBookingSources().catch(() => [] as BookingSource[]),
        ])
        if (cancelled) return
        setRooms(r)
        setBookings(b)
        setGuests(g)
        setGuestProfiles(profiles)
        setRoomDailyPrices(buildRoomDailyPricesMap(dailyPrices))
        setRoomSpecialConditions(
          specialConditions.reduce<RoomSpecialConditionsMap>((acc, item) => {
            acc[item.roomId] ??= []
            acc[item.roomId]!.push(item)
            return acc
          }, {}),
        )
        setRoomClosures(
          closures.reduce<RoomClosuresMap>((acc, item) => {
            acc[item.roomId] ??= []
            acc[item.roomId]!.push(item)
            return acc
          }, {}),
        )
        setAvailableAdditionalServices(addServices)
        setBookingAdditionalServicesState(
          bookingServices.reduce<BookingAdditionalServicesMap>((acc, item) => {
            acc[item.bookingId] ??= []
            acc[item.bookingId]!.push(item)
            return acc
          }, {}),
        )
        setBookingSubGuestsState(
          subGuests.reduce<BookingSubGuestsMap>((acc, item) => {
            acc[item.bookingId] ??= []
            acc[item.bookingId]!.push(item)
            return acc
          }, {}),
        )
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
    const unsub = subscribeRoomClosuresRealtime(() => {
      void fetchRoomClosures()
        .then((closures) => {
          setRoomClosures(
            closures.reduce<RoomClosuresMap>((acc, item) => {
              acc[item.roomId] ??= []
              acc[item.roomId]!.push(item)
              return acc
            }, {}),
          )
        })
        .catch(() => {
          /* оставляем текущий список закрытий */
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

  useEffect(() => {
    setNewBookingAdditionalServices((prev) => {
      const next: Record<string, { checked: boolean; quantity: number; unitPrice: number }> = {}
      availableAdditionalServices.forEach((service) => {
        const existing = prev[service.id]
        next[service.id] = existing ?? {
          checked: false,
          quantity: 1,
          unitPrice: service.price,
        }
      })
      return next
    })
  }, [availableAdditionalServices])

  useEffect(() => {
    const subGuestsCount = Math.max(1, Number.parseInt(bookingForm.guestsCount, 10) || 1)
    const childrenCount = Math.max(0, Number.parseInt(bookingForm.childrenCount, 10) || 0)
    setNewBookingSubGuests((prev) => {
      const next = Array.from({ length: subGuestsCount }, (_, idx) => {
        const position = idx + 1
        const existing = prev.find((x) => x.position === position)
        return (
          existing ?? {
            id: randomUUID(),
            position,
            lastName: '',
            firstName: '',
            middleName: '',
            passportData: '',
            isChild: false,
            age: '',
            birthCertificate: '',
          }
        )
      })
      return next.map((item, idx) => {
        const shouldBeChild = idx >= next.length - childrenCount
        if (shouldBeChild) return { ...item, isChild: true }
        return { ...item, isChild: false, age: '', birthCertificate: '' }
      })
    })
    if (subGuestsCount === 0) setActiveNewSubGuestId(null)
  }, [bookingForm.guestsCount, bookingForm.childrenCount])

  async function handleCreateBooking() {
    setBookingError('')
    const start = parseISO(bookingForm.startDate)
    const end = parseISO(bookingForm.endDate)

    if (!bookingForm.roomId) {
      setBookingError('Выберите комнату.')
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
    const guestsCountNum = Number.parseInt(bookingForm.guestsCount, 10)
    const childrenCountNum = Number.parseInt(bookingForm.childrenCount, 10)
    if (!Number.isFinite(guestsCountNum) || guestsCountNum < 1) {
      setBookingError('Количество проживающих должно быть не меньше 1.')
      return
    }
    if (!Number.isFinite(childrenCountNum) || childrenCountNum < 0 || childrenCountNum > guestsCountNum) {
      setBookingError('Количество детей не может превышать число проживающих.')
      return
    }
    if (guestsCountNum > selectedNewBookingRoomCapacity) {
      setBookingError(`Количество проживающих не может превышать вместимость номера (${selectedNewBookingRoomCapacity}).`)
      return
    }
    const requiredSubGuests = Math.max(1, guestsCountNum)
    if (newBookingSubGuests.length !== requiredSubGuests) {
      setBookingError('Заполните данные по каждому гостю.')
      return
    }
    if (newBookingSubGuests.some((x) => !x.firstName.trim() || !x.lastName.trim())) {
      setBookingError('Для каждого гостя укажите имя и фамилию.')
      return
    }
    if (
      newBookingSubGuests.some(
        (x) =>
          x.isChild &&
          (!x.age.trim() || Number.isNaN(Number.parseInt(x.age, 10)) || !x.birthCertificate.trim()),
      )
    ) {
      setBookingError('Для ребёнка укажите возраст и свидетельство о рождении.')
      return
    }
    const primaryGuest = newBookingSubGuests.find((x) => x.position === 1)
    const fn = primaryGuest?.firstName.trim() ?? ''
    const ln = primaryGuest?.lastName.trim() ?? ''
    const middle = primaryGuest?.middleName.trim() ?? ''
    if (!fn || !ln) {
      setBookingError('Заполните данные Гостя 1 (имя и фамилия).')
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
    if (
      doesRoomClosureOverlapRange(
        bookingForm.roomId,
        bookingForm.startDate,
        bookingForm.endDate,
        roomClosures[bookingForm.roomId] ?? [],
        bookingForm.checkInTime,
        bookingForm.checkOutTime,
      )
    ) {
      setBookingError('Номер закрыт на выбранные даты (ремонт/обслуживание).')
      return
    }

    const citizenshipRaw = bookingForm.citizenshipId.trim()
    const citizenshipIdNum = citizenshipRaw
      ? Number.parseInt(citizenshipRaw, 10)
      : NaN
    const citizenshipId = Number.isFinite(citizenshipIdNum) ? citizenshipIdNum : null
    let guestProfileId: string
    try {
      guestProfileId = await resolveGuestProfileId({
        guestProfileIdInput: bookingForm.guestProfileId,
        firstName: fn,
        lastName: ln,
        middleName: middle,
        citizenshipId,
        phone: bookingForm.phone,
        email: bookingForm.email,
      })
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : 'Не удалось определить профиль гостя.')
      return
    }
    const guestId = randomUUID()
    const guestNameForBooking = buildGuestDisplayName(ln, fn, middle)

    const newGuest: Guest = {
      id: guestId,
      profileId: guestProfileId,
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
      paymentStatus: bookingForm.paymentStatus,
      paymentMethod: guestPaymentMethodFromForm(bookingForm.paymentStatus, bookingForm.paymentChannel),
      aprove: false,
      checkedInAt: null,
      checkedOutAt: null,
    }

    const cit = normalizeCheckInTime(bookingForm.checkInTime)
    const cot = normalizeCheckInTime(bookingForm.checkOutTime)
    const freshPricing = await getFreshPricingData()
    const totalPrice = calcBookingTotalPrice(
      bookingForm.roomId,
      bookingForm.startDate,
      bookingForm.endDate,
      freshPricing.dailyPrices,
      freshPricing.specialConditions,
    )
    const newBooking: Booking = {
      id: randomUUID(),
      roomId: bookingForm.roomId,
      guestName: guestNameForBooking,
      startDate: bookingForm.startDate,
      endDate: bookingForm.endDate,
      paymentStatus: bookingForm.paymentStatus,
      totalPrice,
      checkInTime: cit && cit !== '00:00' ? cit : undefined,
      checkOutTime: cot && cot !== '12:00' ? cot : undefined,
      note: bookingForm.note.trim() || undefined,
      guestId,
      bookingSourceId: bookingSources.length > 0 ? srcId : null,
      guestsCount: guestsCountNum,
      childrenCount: childrenCountNum,
    }

    const nextGuests = [...guests, newGuest]
    const nextBookings = [...bookings, newBooking]
    const additionalServicesPayload = availableAdditionalServices
      .map((service) => {
        const row = newBookingAdditionalServices[service.id]
        if (!row?.checked) return null
        return {
          serviceId: service.id,
          quantity: row.quantity > 0 ? row.quantity : 1,
          unitPrice: row.unitPrice >= 0 ? row.unitPrice : service.price,
        }
      })
      .filter((x): x is { serviceId: string; quantity: number; unitPrice: number } => x !== null)
    const subGuestsPayload = newBookingSubGuests.map((x) => ({
      id: x.id,
      position: x.position,
      lastName: x.lastName.trim(),
      firstName: x.firstName.trim(),
      middleName: x.middleName.trim() || null,
      passportData: x.passportData.trim() || null,
      isChild: x.isChild,
      age: x.isChild ? Number.parseInt(x.age, 10) : null,
      birthCertificate: x.isChild ? x.birthCertificate.trim() || null : null,
    }))
    try {
      await syncGuestsAndBookings(nextGuests, nextBookings)
      if (additionalServicesPayload.length > 0) {
        await setBookingAdditionalServices(newBooking.id, additionalServicesPayload)
      }
      if (subGuestsPayload.length > 0) {
        await setBookingSubGuestsInDb(newBooking.id, subGuestsPayload)
      }
    } catch {
      setBookingError('Не удалось сохранить бронь, гостя или дополнительные услуги.')
      return
    }
    setGuests(nextGuests)
    setBookings(nextBookings)
    if (additionalServicesPayload.length > 0) {
      setBookingAdditionalServicesState((prev) => ({
        ...prev,
        [newBooking.id]: additionalServicesPayload.map((item) => {
          const service = availableAdditionalServices.find((s) => s.id === item.serviceId)
          return {
            bookingId: newBooking.id,
            serviceId: item.serviceId,
            serviceName: service?.name ?? 'Услуга',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }
        }),
      }))
    }
    if (subGuestsPayload.length > 0) {
      setBookingSubGuestsState((prev) => ({
        ...prev,
        [newBooking.id]: subGuestsPayload.map((x) => ({ ...x, bookingId: newBooking.id })),
      }))
    }
    setNewBookingAdditionalServices(
      availableAdditionalServices.reduce<Record<string, { checked: boolean; quantity: number; unitPrice: number }>>(
        (acc, service) => {
          acc[service.id] = { checked: false, quantity: 1, unitPrice: service.price }
          return acc
        },
        {},
      ),
    )
    setNewBookingSubGuests([])
    setActiveNewSubGuestId(null)
    setIsBookingModalOpen(false)
  }

  async function getFreshPricingData(): Promise<{
    dailyPrices: RoomDailyPricesMap
    specialConditions: RoomSpecialConditionsMap
  }> {
    try {
      const [dailyRows, specialRows] = await Promise.all([
        fetchRoomDailyPrices(),
        fetchRoomSpecialPriceConditions(),
      ])
      const dailyMap = buildRoomDailyPricesMap(dailyRows)
      const specialMap = specialRows.reduce<RoomSpecialConditionsMap>((acc, item) => {
        acc[item.roomId] ??= []
        acc[item.roomId]!.push(item)
        return acc
      }, {})
      setRoomDailyPrices(dailyMap)
      setRoomSpecialConditions(specialMap)
      return { dailyPrices: dailyMap, specialConditions: specialMap }
    } catch {
      return { dailyPrices: roomDailyPrices, specialConditions: roomSpecialConditions }
    }
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
        guestProfileId: linked?.profileId ?? '',
        citizenshipId,
        phone: linked?.phone ?? '',
        email: linked?.email ?? '',
        bookingSourceId:
          bookingSourceId ||
          (bookingSources.length > 0 ? defaultBookingSourceIdForForm(bookingSources) : ''),
        guestsCount: String(Math.max(1, booking.guestsCount ?? 1)),
        childrenCount: String(booking.childrenCount ?? 0),
        startDate: booking.startDate,
        checkInTime: checkInTimeForTimeInput(booking.checkInTime),
        checkOutTime: checkOutTimeForTimeInput(booking.checkOutTime),
        endDate: booking.endDate,
        paymentStatus: booking.paymentStatus ?? linked?.paymentStatus ?? 'unpaid',
        paymentChannel: linked?.paymentMethod === 'transfer' ? 'transfer' : 'cash',
      })
      const existingSubGuests = bookingSubGuests[booking.id] ?? []
      const primary = existingSubGuests.find((x) => x.position === 1) ?? {
        id: randomUUID(),
        bookingId: booking.id,
        position: 1,
        lastName,
        firstName,
        middleName: middleName || null,
        passportData: null,
        isChild: false,
        age: null,
        birthCertificate: null,
      }
      const mergedSubGuests = [primary, ...existingSubGuests.filter((x) => x.position !== 1)]
      setEditingSubGuests(
        mergedSubGuests.map((item) => ({
          id: item.id,
          position: item.position,
          lastName: item.lastName,
          firstName: item.firstName,
          middleName: item.middleName ?? '',
          passportData: item.passportData ?? '',
          isChild: item.isChild,
          age: item.age != null ? String(item.age) : '',
          birthCertificate: item.birthCertificate ?? '',
        })),
      )
      setEditSubGuestsTemplateBookingId('')
      setActiveSubGuestId(null)
      const selected = bookingAdditionalServices[booking.id] ?? []
      const nextEditing: Record<string, { checked: boolean; quantity: number; unitPrice: number }> = {}
      availableAdditionalServices.forEach((service) => {
        const linked = selected.find((x) => x.serviceId === service.id)
        nextEditing[service.id] = {
          checked: Boolean(linked),
          quantity: linked?.quantity ?? 1,
          unitPrice: linked?.unitPrice ?? service.price,
        }
      })
      setEditingAdditionalServices(nextEditing)
      setEditBookingOpen(true)
    },
    [guests, bookingSources, bookingAdditionalServices, availableAdditionalServices, bookingSubGuests],
  )

  const handlePersistBookingGuest = useCallback(
    (setAprove: boolean) => {
      setEditBookingError('')
      if (!editBookingForm) return
      const {
        bookingId,
        roomId,
        guestProfileId: guestProfileIdInput,
        citizenshipId: citizenshipIdStr,
        phone,
        email,
        bookingSourceId: bookingSourceIdStr,
        guestsCount: guestsCountStr,
        childrenCount: childrenCountStr,
        startDate,
        checkInTime,
        checkOutTime,
        endDate,
        paymentStatus: formPaymentStatus,
        paymentChannel: formPaymentChannel,
      } = editBookingForm

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
      if (
        doesRoomClosureOverlapRange(
          roomId,
          startDate,
          endDate,
          roomClosures[roomId] ?? [],
          checkInTime,
          checkOutTime,
        )
      ) {
        setEditBookingError('Номер закрыт на выбранные даты (ремонт/обслуживание).')
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
      const guestsCountNum = Number.parseInt(guestsCountStr, 10)
      const childrenCountNum = Number.parseInt(childrenCountStr, 10)
      if (!Number.isFinite(guestsCountNum) || guestsCountNum < 1) {
        setEditBookingError('Количество проживающих должно быть не меньше 1.')
        return
      }
      if (!Number.isFinite(childrenCountNum) || childrenCountNum < 0 || childrenCountNum > guestsCountNum) {
        setEditBookingError('Количество детей не может превышать число проживающих.')
        return
      }
      const roomCapacity = rooms.find((x) => x.id === roomId)?.capacity ?? 1
      if (guestsCountNum > roomCapacity) {
        setEditBookingError(`Количество проживающих не может превышать вместимость номера (${roomCapacity}).`)
        return
      }
      const requiredSubGuests = Math.max(1, guestsCountNum)
      if (editingSubGuests.length !== requiredSubGuests) {
        setEditBookingError('Заполните данные по каждому гостю.')
        return
      }
      if (
        editingSubGuests.some((x) => !x.firstName.trim() || !x.lastName.trim())
      ) {
        setEditBookingError('Для каждого гостя укажите имя и фамилию.')
        return
      }
      if (
        editingSubGuests.some(
          (x) =>
            x.isChild &&
            (!x.age.trim() || Number.isNaN(Number.parseInt(x.age, 10)) || !x.birthCertificate.trim()),
        )
      ) {
        setEditBookingError('Для ребёнка укажите возраст и свидетельство о рождении.')
        return
      }
      const primary = editingSubGuests.find((x) => x.position === 1)
      const fn = primary?.firstName.trim() ?? ''
      const ln = primary?.lastName.trim() ?? ''
      const mid = primary?.middleName.trim() ?? ''
      if (!fn || !ln) {
        setEditBookingError('Заполните данные Гостя 1 (имя и фамилия).')
        return
      }
      const requestedGuestProfileId = guestProfileIdInput.trim()
      if (requestedGuestProfileId && !guestProfilesById.has(requestedGuestProfileId)) {
        setEditBookingError('Профиль гостя с указанным ID не найден.')
        return
      }
      const resolvedGuestProfileId =
        requestedGuestProfileId ||
        generateReadableProfileId(ln, new Set(guestProfiles.map((profile) => profile.id)))
      const subGuestsPayload = editingSubGuests.map((x) => ({
        id: x.id,
        position: x.position,
        lastName: x.lastName.trim(),
        firstName: x.firstName.trim(),
        middleName: x.middleName.trim() || null,
        passportData: x.passportData.trim() || null,
        isChild: x.isChild,
        age: x.isChild ? Number.parseInt(x.age, 10) : null,
        birthCertificate: x.isChild ? x.birthCertificate.trim() || null : null,
      }))

      const guestName = buildGuestDisplayName(ln, fn, mid)
      const resolvedPaymentMethod = guestPaymentMethodFromForm(formPaymentStatus, formPaymentChannel)
      const cit = normalizeCheckInTime(checkInTime)
      const cot = normalizeCheckInTime(checkOutTime)
      const bookingCheckInTime = cit && cit !== '00:00' ? cit : undefined
      const bookingCheckOutTime = cot && cot !== '12:00' ? cot : undefined
      let guestId = b.guestId
      const nextGuests = [...guests]

      if (guestId) {
        const gi = nextGuests.findIndex((g) => g.id === guestId)
        if (gi >= 0) {
          nextGuests[gi] = {
            ...nextGuests[gi],
            profileId: resolvedGuestProfileId,
            firstName: fn,
            lastName: ln,
            middleName: mid || null,
            citizenshipId,
            phone: phone.trim() || null,
            email: email.trim() || null,
            roomId,
            startDate,
            endDate,
            paymentStatus: formPaymentStatus,
            paymentMethod: resolvedPaymentMethod,
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
          id: randomUUID(),
          profileId: resolvedGuestProfileId,
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
          paymentStatus: formPaymentStatus,
          paymentMethod: resolvedPaymentMethod,
          aprove: setAprove,
          checkedInAt: setAprove ? new Date().toISOString() : null,
          checkedOutAt: null,
        }
        nextGuests.push(g)
        guestId = g.id
      }

      void (async () => {
        const freshPricing = await getFreshPricingData()
        const totalPrice = calcBookingTotalPrice(
          roomId,
          startDate,
          endDate,
          freshPricing.dailyPrices,
          freshPricing.specialConditions,
        )
        const nextBookings = bookings.map((booking) =>
          booking.id === bookingId
            ? {
                ...booking,
                roomId,
                guestName,
                guestId,
                startDate,
                endDate,
                paymentStatus: formPaymentStatus,
                totalPrice,
                checkInTime: bookingCheckInTime,
                checkOutTime: bookingCheckOutTime,
                bookingSourceId,
                guestsCount: guestsCountNum,
                childrenCount: childrenCountNum,
              }
            : booking,
        )
        try {
          await upsertGuestProfile({
            id: resolvedGuestProfileId,
            firstName: fn,
            lastName: ln,
            middleName: mid || null,
            citizenshipId,
            phone: phone.trim() || null,
            email: email.trim() || null,
          })
          await syncGuestsAndBookings(nextGuests, nextBookings)
          await setBookingSubGuestsInDb(bookingId, subGuestsPayload)
        } catch {
          setEditBookingError('Не удалось сохранить данные в Supabase.')
          return
        }
        setGuestProfiles((prev) => {
          const nextProfile: GuestProfile = {
            id: resolvedGuestProfileId,
            firstName: fn,
            lastName: ln,
            middleName: mid || null,
            citizenshipId,
            phone: phone.trim() || null,
            email: email.trim() || null,
          }
          const idx = prev.findIndex((x) => x.id === nextProfile.id)
          if (idx < 0) return [...prev, nextProfile]
          const next = [...prev]
          next[idx] = nextProfile
          return next
        })
        setGuests(nextGuests)
        setBookings(nextBookings)
        setBookingSubGuestsState((prev) => ({
          ...prev,
          [bookingId]: subGuestsPayload.map((x) => ({ ...x, bookingId })),
        }))
        if (setAprove) {
          setEditBookingOpen(false)
          setEditBookingForm(null)
          return
        }
        // После обычного сохранения оставляем попап открытым и обновляем значения формы.
        setEditBookingForm((prev) =>
          prev
            ? {
                ...prev,
                roomId,
                guestProfileId: resolvedGuestProfileId,
                citizenshipId: citizenshipId != null ? String(citizenshipId) : '',
                phone: phone.trim(),
                email: email.trim(),
                bookingSourceId: bookingSourceId != null ? String(bookingSourceId) : '',
                guestsCount: String(guestsCountNum),
                childrenCount: String(childrenCountNum),
                startDate,
                checkInTime,
                checkOutTime,
                endDate,
              }
            : prev,
        )
      })()
    },
    [
      bookings,
      guests,
      editBookingForm,
      roomDailyPrices,
      roomSpecialConditions,
      roomClosures,
      editingSubGuests,
      guestProfilesById,
      guestProfiles,
    ],
  )

  const handleGuestCheckedOut = useCallback(() => {
    setEditBookingError('')
    if (!editBookingForm) return
    const primary = editingSubGuests.find((x) => x.position === 1)
    const fn = primary?.firstName.trim() ?? ''
    const ln = primary?.lastName.trim() ?? ''
    const mid = primary?.middleName.trim() ?? ''
    if (!fn || !ln) {
      setEditBookingError('Заполните данные Гостя 1 (имя и фамилия).')
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
    if (doesRoomClosureOverlapRange(roomId, startDate, newEndDate, roomClosures[roomId] ?? [])) {
      setEditBookingError('Номер закрыт на выбранные даты (ремонт/обслуживание).')
      return
    }

    const checkedOutAt = new Date().toISOString()
    const guestName = buildGuestDisplayName(ln, fn, mid)

    const nextGuests = guests.map((g) =>
      g.id === b.guestId
        ? {
            ...g,
            firstName: fn,
            lastName: ln,
            middleName: mid || null,
            roomId,
            startDate,
            endDate: newEndDate,
            checkedOutAt,
          }
        : g,
    )

    void (async () => {
      const freshPricing = await getFreshPricingData()
      const totalPrice = calcBookingTotalPrice(
        roomId,
        startDate,
        newEndDate,
        freshPricing.dailyPrices,
        freshPricing.specialConditions,
      )
      const nextBookings = bookings.map((booking) =>
        booking.id === b.id
          ? { ...booking, roomId, guestName, startDate, endDate: newEndDate, totalPrice }
          : booking,
      )
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
  }, [bookings, guests, editBookingForm, roomDailyPrices, roomSpecialConditions, roomClosures, editingSubGuests])

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
      if (
        doesRoomClosureOverlapRange(
          target.roomId,
          next.startDate,
          next.endDate,
          roomClosures[target.roomId] ?? [],
        )
      ) {
        return false
      }
      const nextGuests = target.guestId
        ? guests.map((g) =>
            g.id === target.guestId
              ? { ...g, startDate: next.startDate, endDate: next.endDate }
              : g,
          )
        : guests

      void (async () => {
        const freshPricing = await getFreshPricingData()
        const totalPrice = calcBookingTotalPrice(
          target.roomId,
          next.startDate,
          next.endDate,
          freshPricing.dailyPrices,
          freshPricing.specialConditions,
        )
        const nextBookings = bookings.map((b) =>
          b.id === bookingId
            ? { ...b, startDate: next.startDate, endDate: next.endDate, totalPrice }
            : b,
        )
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
    [bookings, guests, roomDailyPrices, roomSpecialConditions, roomClosures],
  )

  const saveBookingAdditionalServices = useCallback(async () => {
    if (!editBookingForm) return
    const bookingId = editBookingForm.bookingId
    const payload = availableAdditionalServices
      .map((service) => {
        const row = editingAdditionalServices[service.id]
        if (!row?.checked) return null
        return {
          serviceId: service.id,
          quantity: row.quantity > 0 ? row.quantity : 1,
          unitPrice: row.unitPrice >= 0 ? row.unitPrice : service.price,
        }
      })
      .filter((x): x is { serviceId: string; quantity: number; unitPrice: number } => x !== null)
    try {
      await setBookingAdditionalServices(bookingId, payload)
      setBookingAdditionalServicesState((prev) => ({
        ...prev,
        [bookingId]: payload.map((item) => {
          const service = availableAdditionalServices.find((s) => s.id === item.serviceId)
          return {
            bookingId,
            serviceId: item.serviceId,
            serviceName: service?.name ?? 'Услуга',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }
        }),
      }))
      setServicesDialogOpen(false)
    } catch {
      setEditBookingError('Не удалось сохранить дополнительные услуги.')
    }
  }, [editBookingForm, availableAdditionalServices, editingAdditionalServices])

  useEffect(() => {
    if (!editBookingForm) return
    const subGuestsCount = Math.max(1, Number.parseInt(editBookingForm.guestsCount, 10) || 1)
    const childrenCount = Math.max(0, Number.parseInt(editBookingForm.childrenCount, 10) || 0)
    setEditingSubGuests((prev) => {
      const next = Array.from({ length: subGuestsCount }, (_, idx) => {
        const position = idx + 1
        const existing = prev.find((x) => x.position === position)
        return (
          existing ?? {
            id: randomUUID(),
            position,
            lastName: '',
            firstName: '',
            middleName: '',
            passportData: '',
            isChild: false,
            age: '',
            birthCertificate: '',
          }
        )
      })
      return next.map((item, idx) => {
        const shouldBeChild = idx >= next.length - childrenCount
        if (shouldBeChild) return { ...item, isChild: true }
        return { ...item, isChild: false, age: '', birthCertificate: '' }
      })
    })
    if (subGuestsCount === 0) setActiveSubGuestId(null)
  }, [editBookingForm?.guestsCount, editBookingForm?.childrenCount, editBookingForm?.bookingId])

  const subGuestTemplatesByProfileId = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        bookingId: string
        label: string
        guestsCount: number
        childrenCount: number
        guests: Array<{
          position: number
          lastName: string
          firstName: string
          middleName: string
          passportData: string
          isChild: boolean
          age: string
          birthCertificate: string
        }>
      }>
    >()
    guests.forEach((guest) => {
      const profileId = guest.profileId?.trim()
      if (!profileId) return
      const booking = latestBookingByGuestId.get(guest.id)
      if (!booking) return
      const list = bookingSubGuests[booking.id] ?? []
      if (list.length === 0) return
      const normalized = [...list]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          position: item.position,
          lastName: item.lastName,
          firstName: item.firstName,
          middleName: item.middleName ?? '',
          passportData: item.passportData ?? '',
          isChild: item.isChild,
          age: item.age != null ? String(item.age) : '',
          birthCertificate: item.birthCertificate ?? '',
        }))
      const childrenCount = normalized.filter((x) => x.isChild).length
      const template = {
        bookingId: booking.id,
        label: `${booking.startDate} - ${booking.endDate} (${normalized.length} г.)`,
        guestsCount: normalized.length,
        childrenCount,
        guests: normalized,
      }
      const current = map.get(profileId) ?? []
      if (!current.some((x) => x.bookingId === booking.id)) {
        current.push(template)
      }
      map.set(
        profileId,
        current.sort((a, b) => b.label.localeCompare(a.label, 'ru')),
      )
    })
    return map
  }, [guests, latestBookingByGuestId, bookingSubGuests])

  const applySubGuestTemplateToNewBooking = useCallback(
    (profileIdInput: string, templateBookingId?: string, roomIdOverride?: string) => {
      const profileId = profileIdInput.trim()
      if (!profileId) return
      const templates = subGuestTemplatesByProfileId.get(profileId) ?? []
      if (templates.length === 0) return
      const template =
        templates.find((x) => x.bookingId === templateBookingId) ?? templates[0]
      const targetRoomId = roomIdOverride ?? bookingForm.roomId
      const roomCapacity = Math.max(1, rooms.find((x) => x.id === targetRoomId)?.capacity ?? 1)
      if (template.guestsCount > roomCapacity) {
        setNewBookingTemplateCapacityWarning(
          `В прошлом визите ${template.guestsCount} гостей, но вместимость выбранного номера ${roomCapacity}. Выберите доступное количество проживающих.`,
        )
        setNewBookingTemplateRequiredGuests(template.guestsCount)
        setPendingTemplateProfileId(profileId)
        setPendingTemplateBookingId(template.bookingId)
        return
      }
      setBookingForm((prev) => ({
        ...prev,
        roomId: targetRoomId || prev.roomId,
        guestsCount: String(template.guestsCount),
        childrenCount: String(template.childrenCount),
      }))
      setNewBookingSubGuests(
        template.guests.map((item) => ({
          ...item,
          id: randomUUID(),
        })),
      )
      setNewBookingTemplateCapacityWarning('')
      setNewBookingTemplateRequiredGuests(null)
      setPendingTemplateProfileId('')
      setPendingTemplateBookingId('')
      setNewSubGuestsTemplateBookingId(template.bookingId)
    },
    [subGuestTemplatesByProfileId, rooms, bookingForm.roomId],
  )

  const applySubGuestTemplateToEditBooking = useCallback(
    (profileIdInput: string, templateBookingId?: string) => {
      if (!editBookingForm) return
      const profileId = profileIdInput.trim()
      if (!profileId) return
      const templates = subGuestTemplatesByProfileId.get(profileId) ?? []
      if (templates.length === 0) return
      const template =
        templates.find((x) => x.bookingId === templateBookingId) ?? templates[0]
      setEditBookingForm((prev) =>
        prev
          ? {
              ...prev,
              guestsCount: String(template.guestsCount),
              childrenCount: String(template.childrenCount),
            }
          : prev,
      )
      setEditingSubGuests(
        template.guests.map((item) => ({
          ...item,
          id: randomUUID(),
        })),
      )
      setEditSubGuestsTemplateBookingId(template.bookingId)
    },
    [editBookingForm, subGuestTemplatesByProfileId],
  )

  useEffect(() => {
    const profileId = bookingForm.guestProfileId.trim()
    if (!profileId) {
      setNewSubGuestsTemplateBookingId('')
      setNewBookingTemplateCapacityWarning('')
      setNewBookingTemplateRequiredGuests(null)
      setPendingTemplateProfileId('')
      setPendingTemplateBookingId('')
      return
    }
    const templates = subGuestTemplatesByProfileId.get(profileId) ?? []
    if (templates.length === 0) return
    if (newSubGuestsTemplateBookingId && templates.some((x) => x.bookingId === newSubGuestsTemplateBookingId)) {
      return
    }
    applySubGuestTemplateToNewBooking(profileId, templates[0].bookingId)
  }, [
    bookingForm.guestProfileId,
    subGuestTemplatesByProfileId,
    newSubGuestsTemplateBookingId,
    applySubGuestTemplateToNewBooking,
  ])

  useEffect(() => {
    const guestsCountNum = Number.parseInt(bookingForm.guestsCount, 10)
    if (!Number.isFinite(guestsCountNum)) return
    if (guestsCountNum <= selectedNewBookingRoomCapacity) {
      setNewBookingTemplateCapacityWarning('')
      setNewBookingTemplateRequiredGuests(null)
    }
  }, [bookingForm.guestsCount, selectedNewBookingRoomCapacity])

  const resolveGuestProfileId = useCallback(
    async (params: {
      guestProfileIdInput: string
      firstName: string
      lastName: string
      middleName: string
      citizenshipId: number | null
      phone: string
      email: string
    }) => {
      const requestedId = params.guestProfileIdInput.trim()
      const profileId =
        requestedId ||
        generateReadableProfileId(
          params.lastName,
          new Set(guestProfiles.map((profile) => profile.id)),
        )
      if (requestedId && !guestProfilesById.has(requestedId)) {
        throw new Error('Профиль гостя с указанным ID не найден.')
      }
      const profile: GuestProfile = {
        id: profileId,
        firstName: params.firstName,
        lastName: params.lastName,
        middleName: params.middleName || null,
        citizenshipId: params.citizenshipId,
        phone: params.phone.trim() || null,
        email: params.email.trim() || null,
      }
      await upsertGuestProfile(profile)
      setGuestProfiles((prev) => {
        const idx = prev.findIndex((x) => x.id === profile.id)
        if (idx < 0) return [...prev, profile]
        const next = [...prev]
        next[idx] = profile
        return next
      })
      return profileId
    },
    [guestProfilesById, guestProfiles],
  )

  const handleRoomClosureClick = useCallback((closure: RoomClosure) => {
    setClosureEditError('')
    setClosureEditDialog({
      roomId: closure.roomId,
      closureId: closure.id,
      startAt: toLocalDateTimeInputValue(closure.startAt),
      endAt: toLocalDateTimeInputValue(closure.endAt),
      reason: closure.reason ?? '',
    })
  }, [])

  const handleSaveRoomClosureEdit = useCallback(async () => {
    if (!closureEditDialog) return
    setClosureEditError('')
    const startIso = fromLocalDateTimeInputValue(closureEditDialog.startAt)
    const endIso = fromLocalDateTimeInputValue(closureEditDialog.endAt)
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
      setClosureEditError('Дата окончания закрытия не может быть раньше даты начала.')
      return
    }
    const roomId = closureEditDialog.roomId
    const current = roomClosures[roomId] ?? []
    const updated = current.map((item) =>
      item.id === closureEditDialog.closureId
        ? { ...item, startAt: startIso, endAt: endIso, reason: closureEditDialog.reason.trim() }
        : item,
    )
    setIsSavingClosureEdit(true)
    try {
      await setRoomClosuresInDb(
        roomId,
        updated.map((x) => ({
          id: x.id,
          startAt: x.startAt,
          endAt: x.endAt,
          reason: x.reason,
          createdByUserId: x.createdByUserId ?? null,
          createdByName: x.createdByName ?? null,
          repairCompletedAt: x.repairCompletedAt ?? null,
          resolvedIssues: x.resolvedIssues ?? null,
          repairedByUserId: x.repairedByUserId ?? null,
          repairedByName: x.repairedByName ?? null,
          checkedAt: x.checkedAt ?? null,
          checkedByUserId: x.checkedByUserId ?? null,
          checkedByName: x.checkedByName ?? null,
          checkedByRole: x.checkedByRole ?? null,
          checkedComment: x.checkedComment ?? null,
          assignedTechnicianUserId: x.assignedTechnicianUserId ?? null,
          assignedTechnicianName: x.assignedTechnicianName ?? null,
        })),
      )
      setRoomClosures((prev) => ({ ...prev, [roomId]: updated }))
      setClosureEditDialog(null)
    } catch {
      setClosureEditError('Не удалось сохранить изменения закрытия номера.')
    } finally {
      setIsSavingClosureEdit(false)
    }
  }, [closureEditDialog, roomClosures])

  const handleDeleteRoomClosureEdit = useCallback(async () => {
    if (!closureEditDialog) return
    const roomId = closureEditDialog.roomId
    const current = roomClosures[roomId] ?? []
    const nextClosures = current.filter((item) => item.id !== closureEditDialog.closureId)
    setClosureEditError('')
    setIsSavingClosureEdit(true)
    try {
      await setRoomClosuresInDb(
        roomId,
        nextClosures.map((x) => ({
          id: x.id,
          startAt: x.startAt,
          endAt: x.endAt,
          reason: x.reason,
          createdByUserId: x.createdByUserId ?? null,
          createdByName: x.createdByName ?? null,
          repairCompletedAt: x.repairCompletedAt ?? null,
          resolvedIssues: x.resolvedIssues ?? null,
          repairedByUserId: x.repairedByUserId ?? null,
          repairedByName: x.repairedByName ?? null,
          checkedAt: x.checkedAt ?? null,
          checkedByUserId: x.checkedByUserId ?? null,
          checkedByName: x.checkedByName ?? null,
          checkedByRole: x.checkedByRole ?? null,
          checkedComment: x.checkedComment ?? null,
          assignedTechnicianUserId: x.assignedTechnicianUserId ?? null,
          assignedTechnicianName: x.assignedTechnicianName ?? null,
        })),
      )
      setRoomClosures((prev) => ({ ...prev, [roomId]: nextClosures }))
      setClosureEditDialog(null)
    } catch {
      setClosureEditError('Не удалось удалить закрытие номера.')
    } finally {
      setIsSavingClosureEdit(false)
    }
  }, [closureEditDialog, roomClosures])

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
                    setNewSubGuestsTemplateBookingId('')
                    setNewBookingTemplateCapacityWarning('')
                    setNewBookingTemplateRequiredGuests(null)
                    setPendingTemplateProfileId('')
                    setPendingTemplateBookingId('')
                    setNewBookingAdditionalServices(
                      availableAdditionalServices.reduce<Record<string, { checked: boolean; quantity: number; unitPrice: number }>>(
                        (acc, service) => {
                          acc[service.id] = { checked: false, quantity: 1, unitPrice: service.price }
                          return acc
                        },
                        {},
                      ),
                    )
                  }
                } else {
                  setBookingError('')
                  setNewBookingServicesDialogOpen(false)
                  setNewBookingSubGuestsDialogOpen(false)
                  setActiveNewSubGuestId(null)
                  setNewSubGuestsTemplateBookingId('')
                  setNewBookingTemplateCapacityWarning('')
                  setNewBookingTemplateRequiredGuests(null)
                  setPendingTemplateProfileId('')
                  setPendingTemplateBookingId('')
                }
              }}
            >
              <DialogTrigger asChild>
                <Button className="shrink-0 shadow-sm">Добавить бронь</Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая бронь</DialogTitle>
                <DialogDescription />
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
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="bkPaymentStatus">Статус оплаты</Label>
                    <select
                      id="bkPaymentStatus"
                      className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={bookingForm.paymentStatus}
                      onChange={(event) =>
                        setBookingForm((prev) => ({
                          ...prev,
                          paymentStatus: event.target.value as PaymentStatus,
                        }))
                      }
                    >
                      <option value="unpaid">Не оплачен</option>
                      <option value="paid">Оплачен</option>
                    </select>
                  </div>
                  {bookingForm.paymentStatus === 'paid' ? (
                    <div className="grid min-w-0 gap-2">
                      <Label htmlFor="bkPaymentChannel">Способ оплаты</Label>
                      <select
                        id="bkPaymentChannel"
                        className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={bookingForm.paymentChannel}
                        onChange={(event) =>
                          setBookingForm((prev) => ({
                            ...prev,
                            paymentChannel: event.target.value as 'cash' | 'transfer',
                          }))
                        }
                      >
                        <option value="cash">Наличные</option>
                        <option value="transfer">Безналичные</option>
                      </select>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bkGuestProfileId">ID гостя (профиль)</Label>
                  <Input
                    id="bkGuestProfileId"
                    value={bookingForm.guestProfileId}
                    onChange={(event) =>
                      setBookingForm((prev) => ({ ...prev, guestProfileId: event.target.value }))
                    }
                    placeholder="Оставьте пустым для нового профиля"
                  />
                  {newProfileSearchMatches.length > 0 ? (
                    <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-background">
                      {newProfileSearchMatches.map((profile) => (
                        <button
                          key={`new-profile-suggestion-${profile.id}`}
                          type="button"
                          className="block w-full border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/50"
                          onClick={() =>
                            setBookingForm((prev) => ({ ...prev, guestProfileId: profile.id }))
                          }
                        >
                          <span className="font-medium">{profile.id}</span>{' '}
                          <span className="text-muted-foreground">
                            ({[profile.lastName, profile.firstName, profile.middleName?.trim()].filter(Boolean).join(' ')})
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {(() => {
                    const input = bookingForm.guestProfileId.trim()
                    if (!input) return null
                    const profile = guestProfilesById.get(input)
                    if (profile) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          Найден профиль: {formatGuestProfileLabel(profile)}
                        </p>
                      )
                    }
                    return (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Профиль с таким ID не найден. Будет создан новый только после сохранения.
                      </p>
                    )
                  })()}
                </div>
                {(() => {
                  const templates = subGuestTemplatesByProfileId.get(bookingForm.guestProfileId.trim()) ?? []
                  if (templates.length === 0) return null
                  return (
                    <div className="grid gap-2">
                      <Label htmlFor="bkSubGuestsTemplate">Субгости из прошлых визитов</Label>
                      <select
                        id="bkSubGuestsTemplate"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={newSubGuestsTemplateBookingId || templates[0]!.bookingId}
                        onChange={(event) => {
                          applySubGuestTemplateToNewBooking(
                            bookingForm.guestProfileId,
                            event.target.value,
                          )
                        }}
                      >
                        {templates.map((template) => (
                          <option key={template.bookingId} value={template.bookingId}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                      {newBookingTemplateCapacityWarning ? (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            {newBookingTemplateCapacityWarning}
                          </p>
                          {suggestedRoomsForTemplate.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                Предложенные номера:
                              </span>
                              {suggestedRoomsForTemplate.map((room) => (
                                <Button
                                  key={`suggested-room-${room.id}`}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const profileId = pendingTemplateProfileId || bookingForm.guestProfileId
                                    const templateId =
                                      pendingTemplateBookingId ||
                                      newSubGuestsTemplateBookingId ||
                                      templates[0]!.bookingId
                                    applySubGuestTemplateToNewBooking(profileId, templateId, room.id)
                                  }}
                                >
                                  {room.name} (вмест.: {room.capacity})
                                </Button>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Нет доступных номеров с нужной вместимостью на выбранные даты.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })()}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="bkGuestsCount">Кол-во проживающих</Label>
                    <select
                      id="bkGuestsCount"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={bookingForm.guestsCount}
                      onChange={(event) =>
                        setBookingForm((prev) => {
                          const nextGuestsCount = event.target.value
                          const nextGuestsCountNum = Number.parseInt(nextGuestsCount, 10)
                          const currentChildrenNum = Number.parseInt(prev.childrenCount, 10)
                          return {
                            ...prev,
                            guestsCount: nextGuestsCount,
                            childrenCount:
                              Number.isFinite(currentChildrenNum) && currentChildrenNum <= Math.max(1, nextGuestsCountNum)
                                ? prev.childrenCount
                                : String(Math.max(1, nextGuestsCountNum)),
                          }
                        })
                      }
                    >
                      {Array.from({ length: selectedNewBookingRoomCapacity }, (_, i) => i + 1).map((n) => (
                        <option key={`new-guests-${n}`} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bkChildrenCount">Кол-во детей</Label>
                    <select
                      id="bkChildrenCount"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={bookingForm.childrenCount}
                      onChange={(event) =>
                        setBookingForm((prev) => ({ ...prev, childrenCount: event.target.value }))
                      }
                    >
                      {Array.from(
                        { length: Math.max(1, Number.parseInt(bookingForm.guestsCount, 10) || 1) + 1 },
                        (_, i) => i,
                      ).map((n) => (
                        <option key={`new-children-${n}`} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {newBookingSubGuests.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {newBookingSubGuests.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant={activeNewSubGuestId === item.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setActiveNewSubGuestId(item.id)
                          setNewBookingSubGuestsDialogOpen(true)
                        }}
                      >
                        Гость {item.position}
                      </Button>
                    ))}
                  </div>
                ) : null}
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
                <div>
                  <Button type="button" variant="outline" onClick={() => setNewBookingServicesDialogOpen(true)}>
                    Дополнительные услуги
                  </Button>
                </div>

                {bookingError ? <p className="text-sm text-red-600">{bookingError}</p> : null}
                <Button onClick={handleCreateBooking}>Сохранить бронь</Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
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
                  bookings={bookings}
                  bookingSubGuests={bookingSubGuestsFlat}
                  currentUser={user!}
                  loadError={stickyNotesLoadError}
                />
              ) : null}
              <div
                className={cn(
                  'mb-4 grid min-w-0 shrink-0 gap-3 sm:gap-4',
                  admin ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1',
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
                {admin ? (
                  <section
                    className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-muted/20 p-3 shadow-sm dark:bg-card/50 sm:p-4"
                    aria-label="Закрытые номера на текущую дату"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">Закрытые номера</h3>
                    </div>
                    {closedRoomsToday.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        На текущую дату закрытых номеров нет.
                      </p>
                    ) : (
                      <ul className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto">
                        {closedRoomsToday.map(({ closure, room }) => {
                          const hoverTitle = [
                            `${room?.name ?? closure.roomId}${room?.category ? ` · ${room.category}` : ''}`,
                            `Период: ${format(parseISO(closure.startAt), 'dd.MM.yyyy HH:mm')} - ${format(parseISO(closure.endAt), 'dd.MM.yyyy HH:mm')}`,
                            `Причина: ${closure.reason || 'не указана'}`,
                            `Закрыл: ${closure.createdByName ?? 'неизвестно'}`,
                          ].join('\n')
                          return (
                            <li key={`closed-room-${closure.id}`} className="max-w-[14rem] list-none">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="cursor-default rounded-md border border-red-200/90 bg-red-50 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-red-900/55 dark:bg-red-950/35"
                                    tabIndex={0}
                                  >
                                    <p className="truncate text-xs font-medium leading-tight text-red-950 dark:text-red-50">
                                      {room?.name ?? closure.roomId}
                                    </p>
                                    <p className="truncate text-[10px] leading-tight text-red-900/75 dark:text-red-200/80">
                                      {format(parseISO(closure.startAt), 'dd.MM HH:mm')} - {format(parseISO(closure.endAt), 'dd.MM HH:mm')}
                                    </p>
                                    <p className="truncate text-[10px] leading-tight text-red-900/75 dark:text-red-200/80">
                                      {closure.reason || 'Причина не указана'}
                                    </p>
                                    <p className="truncate text-[10px] leading-tight text-red-900/75 dark:text-red-200/80">
                                      Закрыл: {closure.createdByName ?? 'неизвестно'}
                                    </p>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="whitespace-pre-line">
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
                roomClosures={Object.values(roomClosures).flat()}
                onNewBookingRequest={openNewBookingFromGrid}
                onBookingDatesChange={applyBookingDatesChange}
                onBookingEditClick={openBookingGuestDialog}
                onRoomCleaningStatusClick={
                  canEditRoomCleaningFromGrid ? cycleRoomCleaningFromGrid : undefined
                }
                roomCleaningSavingRoomId={roomCleaningSavingRoomId}
                guestIdsWithStickyNotes={guestIdsWithStickyNotes}
                onRoomClosureClick={handleRoomClosureClick}
              />
            </>
          )}
        </div>
      </div>

      <Dialog
        open={closureEditDialog !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingClosureEdit) {
            setClosureEditDialog(null)
            setClosureEditError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать закрытие номера</DialogTitle>
            <DialogDescription>
              Измените период и причину закрытия. Изменения сразу применятся к шахматке.
            </DialogDescription>
          </DialogHeader>
          {closureEditDialog ? (
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label htmlFor="closureEditStart">Начало</Label>
                <Input
                  id="closureEditStart"
                  type="datetime-local"
                  value={closureEditDialog.startAt}
                  onChange={(event) =>
                    setClosureEditDialog((prev) =>
                      prev ? { ...prev, startAt: event.target.value } : prev,
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closureEditEnd">Окончание</Label>
                <Input
                  id="closureEditEnd"
                  type="datetime-local"
                  value={closureEditDialog.endAt}
                  onChange={(event) =>
                    setClosureEditDialog((prev) =>
                      prev ? { ...prev, endAt: event.target.value } : prev,
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closureEditReason">Причина</Label>
                <Input
                  id="closureEditReason"
                  value={closureEditDialog.reason}
                  onChange={(event) =>
                    setClosureEditDialog((prev) =>
                      prev ? { ...prev, reason: event.target.value } : prev,
                    )
                  }
                  placeholder="Например: ремонт кондиционера"
                />
              </div>
              {closureEditError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{closureEditError}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={() => void handleDeleteRoomClosureEdit()}
                  disabled={isSavingClosureEdit}
                >
                  Удалить закрытие
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setClosureEditDialog(null)
                    setClosureEditError('')
                  }}
                  disabled={isSavingClosureEdit}
                >
                  Отмена
                </Button>
                <Button type="button" onClick={() => void handleSaveRoomClosureEdit()} disabled={isSavingClosureEdit}>
                  {isSavingClosureEdit ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editBookingOpen}
        onOpenChange={(open) => {
          setEditBookingOpen(open)
          if (!open) {
            setCostTooltipOpen(null)
            setServicesDialogOpen(false)
            setSubGuestsDialogOpen(false)
            setActiveSubGuestId(null)
            setEditSubGuestsTemplateBookingId('')
            setEditBookingForm(null)
            setEditBookingError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Бронь и гость</DialogTitle>
            <DialogDescription>
              Редактирование данных брони, гостя и дополнительных услуг.
            </DialogDescription>
          </DialogHeader>
          {editBookingForm ? (
            <div className="grid min-w-0 gap-4 py-2">
              {(() => {
                const booking = bookings.find((x) => x.id === editBookingForm.bookingId)
                if (!booking) return null
                const start = parseISO(booking.startDate)
                const end = parseISO(booking.endDate)
                const days =
                  Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start
                    ? null
                    : eachDayOfInterval({ start, end }).length
                const roomBasePrices = roomDailyPrices[booking.roomId] ?? {}
                const stayDays = days ?? 0
                const baseTotal = days == null
                  ? 0
                  : eachDayOfInterval({ start, end }).reduce((sum, day) => {
                      const dayOfWeek = day.getDay() as DayOfWeek
                      const price = roomBasePrices[dayOfWeek]
                      return sum + (typeof price === 'number' && Number.isFinite(price) ? price : 0)
                    }, 0)
                const activeConditions = (roomSpecialConditions[booking.roomId] ?? []).filter((condition) => {
                  const starts = parseISO(condition.startAt)
                  const ends = parseISO(condition.endAt)
                  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return false
                  return start <= ends && end >= starts
                })
                const specialItems = activeConditions.map((condition) => {
                  const conditionStart = parseISO(condition.startAt)
                  const conditionEnd = parseISO(condition.endAt)
                  if (
                    Number.isNaN(conditionStart.getTime()) ||
                    Number.isNaN(conditionEnd.getTime()) ||
                    Number.isNaN(start.getTime()) ||
                    Number.isNaN(end.getTime())
                  ) {
                    return { label: condition.title, total: 0, days: 0 }
                  }
                  const overlapStart = start > conditionStart ? start : conditionStart
                  const overlapEnd = end < conditionEnd ? end : conditionEnd
                  if (overlapStart > overlapEnd) {
                    return { label: condition.title, total: 0, days: 0 }
                  }
                  const overlapDays = eachDayOfInterval({ start: overlapStart, end: overlapEnd })
                  const total = overlapDays.reduce((sum, day) => {
                    const dayOfWeek = day.getDay() as DayOfWeek
                    const price = condition.prices[dayOfWeek]
                    return sum + (typeof price === 'number' && Number.isFinite(price) ? price : 0)
                  }, 0)
                  return {
                    label: condition.title,
                    total,
                    days: overlapDays.length,
                  }
                })
                const specialTotal = specialItems.reduce((sum, item) => sum + item.total, 0)
                const specialDays = specialItems.reduce((sum, item) => sum + item.days, 0)
                const addItems = bookingAdditionalServices[booking.id] ?? []
                const addServicesTotal = addItems.reduce(
                  (sum, item) => sum + item.unitPrice * item.quantity,
                  0,
                )
                const totalCost = baseTotal + specialTotal + addServicesTotal
                const stayIntervalDays =
                  days == null ? [] : eachDayOfInterval({ start, end })
                const baseDayRows = stayIntervalDays.map((day) => {
                  const dayOfWeek = day.getDay() as DayOfWeek
                  const price = roomBasePrices[dayOfWeek]
                  const amount =
                    typeof price === 'number' && Number.isFinite(price) ? price : 0
                  return `${format(day, 'dd.MM.yyyy')} - ${amount.toLocaleString('ru-RU')} ₽`
                })
                const specialDayRows = stayIntervalDays.map((day) => {
                  const dayAnchor = parseISO(`${format(day, 'yyyy-MM-dd')}T12:00:00`)
                  const dayValue = activeConditions.reduce((sum, condition) => {
                    const starts = parseISO(condition.startAt)
                    const ends = parseISO(condition.endAt)
                    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return sum
                    if (dayAnchor < starts || dayAnchor > ends) return sum
                    const dayOfWeek = day.getDay() as DayOfWeek
                    const value = condition.prices[dayOfWeek]
                    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
                  }, 0)
                  return `${format(day, 'dd.MM.yyyy')} - ${dayValue.toLocaleString('ru-RU')} ₽`
                })
                return (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <div className="relative">
                      <button
                        type="button"
                        className="font-medium underline underline-offset-2"
                        onClick={() =>
                          setCostTooltipOpen((prev) => (prev === 'base' ? null : 'base'))
                        }
                      >
                        Стоимость проживания:
                      </button>{' '}
                      {baseTotal.toLocaleString('ru-RU')} ₽ / {stayDays} сут.
                      {costTooltipOpen === 'base' ? (
                        <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-[min(100%,22rem)] overflow-auto rounded-md border border-border bg-white p-2 text-xs text-foreground shadow-md dark:bg-slate-950">
                          {baseDayRows.length === 0
                            ? 'Нет данных.'
                            : baseDayRows.map((row) => (
                                <div key={`base-${row}`}>{row}</div>
                              ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="relative mt-1">
                      <button
                        type="button"
                        className="font-medium underline underline-offset-2"
                        onClick={() =>
                          setCostTooltipOpen((prev) => (prev === 'special' ? null : 'special'))
                        }
                      >
                        Особые условия:
                      </button>{' '}
                      {specialItems.length === 0
                        ? 'нет'
                        : `${specialItems
                            .map((item) => `"${item.label}" ${item.total.toLocaleString('ru-RU')} ₽ / ${item.days} сут.`)
                            .join('; ')}`}
                      {costTooltipOpen === 'special' ? (
                        <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-[min(100%,22rem)] overflow-auto rounded-md border border-border bg-white p-2 text-xs text-foreground shadow-md dark:bg-slate-950">
                          {specialDayRows.length === 0
                            ? 'Нет данных.'
                            : specialDayRows.map((row) => (
                                <div key={`special-${row}`}>{row}</div>
                              ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 border-t border-border/70 pt-1 font-medium">
                      <div className="mb-1 font-normal">
                        <span className="font-medium">Дополнительные услуги:</span>{' '}
                        {addItems.length === 0
                          ? 'нет'
                          : `${addItems
                              .map(
                                (item) =>
                                  `"${item.serviceName}" ${(item.unitPrice * item.quantity).toLocaleString('ru-RU')} ₽ / ${item.quantity} шт.`,
                              )
                              .join('; ')}`}
                      </div>
                      Итого: {totalCost.toLocaleString('ru-RU')} ₽
                      {specialTotal > 0 || addServicesTotal > 0 ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          ({baseTotal.toLocaleString('ru-RU')} + {specialTotal.toLocaleString('ru-RU')} + {addServicesTotal.toLocaleString('ru-RU')}, доп. {specialDays} сут.)
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })()}
              <div>
                <Button type="button" variant="outline" onClick={() => setServicesDialogOpen(true)}>
                  Дополнительные услуги
                </Button>
              </div>
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
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="editBkPaymentStatus">Статус оплаты</Label>
                  <select
                    id="editBkPaymentStatus"
                    className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={editBookingForm.paymentStatus}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, paymentStatus: e.target.value as PaymentStatus } : prev,
                      )
                    }
                  >
                    <option value="unpaid">Не оплачен</option>
                    <option value="paid">Оплачен</option>
                  </select>
                </div>
                {editBookingForm.paymentStatus === 'paid' ? (
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="editBkPaymentChannel">Способ оплаты</Label>
                    <select
                      id="editBkPaymentChannel"
                      className="h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editBookingForm.paymentChannel}
                      onChange={(e) =>
                        setEditBookingForm((prev) =>
                          prev
                            ? { ...prev, paymentChannel: e.target.value as 'cash' | 'transfer' }
                            : prev,
                        )
                      }
                    >
                      <option value="cash">Наличные</option>
                      <option value="transfer">Безналичные</option>
                    </select>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editBkGuestProfileId">ID гостя (профиль)</Label>
                <Input
                  id="editBkGuestProfileId"
                  value={editBookingForm.guestProfileId}
                  onChange={(e) =>
                    setEditBookingForm((prev) =>
                      prev ? { ...prev, guestProfileId: e.target.value } : prev,
                    )
                  }
                  placeholder="Оставьте пустым для нового профиля"
                />
                {editProfileSearchMatches.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-background">
                    {editProfileSearchMatches.map((profile) => (
                      <button
                        key={`edit-profile-suggestion-${profile.id}`}
                        type="button"
                        className="block w-full border-b border-border px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/50"
                        onClick={() =>
                          setEditBookingForm((prev) =>
                            prev ? { ...prev, guestProfileId: profile.id } : prev,
                          )
                        }
                      >
                        <span className="font-medium">{profile.id}</span>{' '}
                        <span className="text-muted-foreground">
                          ({[profile.lastName, profile.firstName, profile.middleName?.trim()].filter(Boolean).join(' ')})
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {(() => {
                  const input = editBookingForm.guestProfileId.trim()
                  if (!input) return null
                  const profile = guestProfilesById.get(input)
                  if (profile) {
                    return (
                      <p className="text-xs text-muted-foreground">
                        Найден профиль: {formatGuestProfileLabel(profile)}
                      </p>
                    )
                  }
                  return (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Профиль с таким ID не найден. Сохранение с этим ID недоступно.
                    </p>
                  )
                })()}
              </div>
              {(() => {
                const templates = subGuestTemplatesByProfileId.get(editBookingForm.guestProfileId.trim()) ?? []
                if (templates.length === 0) return null
                return (
                  <div className="grid gap-2">
                    <Label htmlFor="editBkSubGuestsTemplate">Субгости из прошлых визитов</Label>
                    <select
                      id="editBkSubGuestsTemplate"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={editSubGuestsTemplateBookingId || templates[0]!.bookingId}
                      onChange={(event) => {
                        applySubGuestTemplateToEditBooking(
                          editBookingForm.guestProfileId,
                          event.target.value,
                        )
                      }}
                    >
                      {templates.map((template) => (
                        <option key={template.bookingId} value={template.bookingId}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })()}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="editBkGuestsCount">Кол-во проживающих</Label>
                  <select
                    id="editBkGuestsCount"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editBookingForm.guestsCount}
                    onChange={(e) =>
                      setEditBookingForm((prev) => {
                        if (!prev) return prev
                        const nextGuestsCount = e.target.value
                        const nextGuestsCountNum = Number.parseInt(nextGuestsCount, 10)
                        const currentChildrenNum = Number.parseInt(prev.childrenCount, 10)
                        return {
                          ...prev,
                          guestsCount: nextGuestsCount,
                          childrenCount:
                            Number.isFinite(currentChildrenNum) && currentChildrenNum <= Math.max(1, nextGuestsCountNum)
                              ? prev.childrenCount
                              : String(Math.max(1, nextGuestsCountNum)),
                        }
                      })
                    }
                  >
                    {Array.from(
                      {
                        length: Math.max(
                          1,
                          rooms.find((x) => x.id === editBookingForm.roomId)?.capacity ?? 1,
                        ),
                      },
                      (_, i) => i + 1,
                    ).map((n) => (
                      <option key={`guests-${n}`} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editBkChildrenCount">Кол-во детей</Label>
                  <select
                    id="editBkChildrenCount"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editBookingForm.childrenCount}
                    onChange={(e) =>
                      setEditBookingForm((prev) =>
                        prev ? { ...prev, childrenCount: e.target.value } : prev,
                      )
                    }
                  >
                    {Array.from(
                      { length: Math.max(1, Number.parseInt(editBookingForm.guestsCount, 10) || 1) + 1 },
                      (_, i) => i,
                    ).map((n) => (
                      <option key={`children-${n}`} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {editingSubGuests.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {editingSubGuests.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      variant={activeSubGuestId === item.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setActiveSubGuestId(item.id)
                        setSubGuestsDialogOpen(true)
                      }}
                    >
                      Гость {item.position}
                    </Button>
                  ))}
                </div>
              ) : null}
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
      <Dialog open={subGuestsDialogOpen} onOpenChange={setSubGuestsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const item = editingSubGuests.find((x) => x.id === activeSubGuestId)
                return item ? `Гость ${item.position}` : 'Гость'
              })()}
            </DialogTitle>
            <DialogDescription>
              Заполните данные по субгостю. Основной гость заполняется в основной форме брони.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const current = editingSubGuests.find((x) => x.id === activeSubGuestId)
            if (!current) {
              return <p className="text-sm text-muted-foreground">Выберите гостя из списка.</p>
            }
            return (
              <div className="grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="subGuestLastName">Фамилия</Label>
                    <Input
                      id="subGuestLastName"
                      value={current.lastName}
                      onChange={(e) =>
                        setEditingSubGuests((prev) =>
                          prev.map((x) =>
                            x.id === current.id ? { ...x, lastName: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="subGuestFirstName">Имя</Label>
                    <Input
                      id="subGuestFirstName"
                      value={current.firstName}
                      onChange={(e) =>
                        setEditingSubGuests((prev) =>
                          prev.map((x) =>
                            x.id === current.id ? { ...x, firstName: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="subGuestMiddleName">Отчество</Label>
                  <Input
                    id="subGuestMiddleName"
                    value={current.middleName}
                    onChange={(e) =>
                      setEditingSubGuests((prev) =>
                        prev.map((x) =>
                          x.id === current.id ? { ...x, middleName: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="subGuestPassport">Паспортные данные</Label>
                  <Input
                    id="subGuestPassport"
                    value={current.passportData}
                    onChange={(e) =>
                      setEditingSubGuests((prev) =>
                        prev.map((x) =>
                          x.id === current.id ? { ...x, passportData: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={current.isChild}
                    onChange={(e) =>
                      setEditingSubGuests((prev) =>
                        prev.map((x) =>
                          x.id === current.id
                            ? {
                                ...x,
                                isChild: e.target.checked,
                                age: e.target.checked ? x.age : '',
                                birthCertificate: e.target.checked ? x.birthCertificate : '',
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  Ребенок
                </label>
                {current.isChild ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="subGuestAge">Возраст</Label>
                      <Input
                        id="subGuestAge"
                        type="number"
                        min={0}
                        value={current.age}
                        onChange={(e) =>
                          setEditingSubGuests((prev) =>
                            prev.map((x) => (x.id === current.id ? { ...x, age: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="subGuestBirthCertificate">Свидетельство о рождении</Label>
                      <Input
                        id="subGuestBirthCertificate"
                        value={current.birthCertificate}
                        onChange={(e) =>
                          setEditingSubGuests((prev) =>
                            prev.map((x) =>
                              x.id === current.id ? { ...x, birthCertificate: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button type="button" onClick={() => setSubGuestsDialogOpen(false)}>
                    Сохранить
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
      <Dialog open={servicesDialogOpen} onOpenChange={setServicesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Дополнительные услуги</DialogTitle>
            <DialogDescription>
              Выберите услуги, укажите количество и при необходимости цену.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {availableAdditionalServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Список услуг пуст.</p>
            ) : (
              availableAdditionalServices.map((service) => {
                const row = editingAdditionalServices[service.id] ?? {
                  checked: false,
                  quantity: 1,
                  unitPrice: service.price,
                }
                return (
                  <div key={service.id} className="grid grid-cols-[auto_1fr_110px_90px] items-center gap-2 rounded-md border p-2">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) =>
                        setEditingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            checked: e.target.checked,
                          },
                        }))
                      }
                      aria-label={`Выбрать услугу ${service.name}`}
                    />
                    <span className="text-sm">{service.name}</span>
                    <Input
                      type="number"
                      min={0}
                      value={row.unitPrice}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setEditingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            unitPrice: Number.isFinite(next) && next >= 0 ? next : row.unitPrice,
                          },
                        }))
                      }}
                      disabled={!row.checked}
                      aria-label={`Стоимость услуги ${service.name}`}
                    />
                    <Input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setEditingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            quantity: Number.isFinite(next) && next > 0 ? next : 1,
                          },
                        }))
                      }}
                      disabled={!row.checked}
                      aria-label={`Количество услуги ${service.name}`}
                    />
                  </div>
                )
              })
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setServicesDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void saveBookingAdditionalServices()}>
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={newBookingServicesDialogOpen} onOpenChange={setNewBookingServicesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Дополнительные услуги</DialogTitle>
            <DialogDescription>
              Выберите услуги для новой брони, укажите количество и при необходимости цену.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {availableAdditionalServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Список услуг пуст.</p>
            ) : (
              availableAdditionalServices.map((service) => {
                const row = newBookingAdditionalServices[service.id] ?? {
                  checked: false,
                  quantity: 1,
                  unitPrice: service.price,
                }
                return (
                  <div key={service.id} className="grid grid-cols-[auto_1fr_110px_90px] items-center gap-2 rounded-md border p-2">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) =>
                        setNewBookingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            checked: e.target.checked,
                          },
                        }))
                      }
                      aria-label={`Выбрать услугу ${service.name}`}
                    />
                    <span className="text-sm">{service.name}</span>
                    <Input
                      type="number"
                      min={0}
                      value={row.unitPrice}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setNewBookingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            unitPrice: Number.isFinite(next) && next >= 0 ? next : row.unitPrice,
                          },
                        }))
                      }}
                      disabled={!row.checked}
                      aria-label={`Стоимость услуги ${service.name}`}
                    />
                    <Input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setNewBookingAdditionalServices((prev) => ({
                          ...prev,
                          [service.id]: {
                            ...row,
                            quantity: Number.isFinite(next) && next > 0 ? next : 1,
                          },
                        }))
                      }}
                      disabled={!row.checked}
                      aria-label={`Количество услуги ${service.name}`}
                    />
                  </div>
                )
              })
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNewBookingServicesDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => setNewBookingServicesDialogOpen(false)}>
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={newBookingSubGuestsDialogOpen} onOpenChange={setNewBookingSubGuestsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const item = newBookingSubGuests.find((x) => x.id === activeNewSubGuestId)
                return item ? `Гость ${item.position}` : 'Гость'
              })()}
            </DialogTitle>
            <DialogDescription>
              Заполните данные по субгостю новой брони. Основной гость задаётся в основной форме.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const current = newBookingSubGuests.find((x) => x.id === activeNewSubGuestId)
            if (!current) return <p className="text-sm text-muted-foreground">Выберите гостя из списка.</p>
            return (
              <div className="grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="newSubGuestLastName">Фамилия</Label>
                    <Input
                      id="newSubGuestLastName"
                      value={current.lastName}
                      onChange={(e) =>
                        setNewBookingSubGuests((prev) =>
                          prev.map((x) => (x.id === current.id ? { ...x, lastName: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="newSubGuestFirstName">Имя</Label>
                    <Input
                      id="newSubGuestFirstName"
                      value={current.firstName}
                      onChange={(e) =>
                        setNewBookingSubGuests((prev) =>
                          prev.map((x) => (x.id === current.id ? { ...x, firstName: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="newSubGuestMiddleName">Отчество</Label>
                  <Input
                    id="newSubGuestMiddleName"
                    value={current.middleName}
                    onChange={(e) =>
                      setNewBookingSubGuests((prev) =>
                        prev.map((x) => (x.id === current.id ? { ...x, middleName: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="newSubGuestPassport">Паспортные данные</Label>
                  <Input
                    id="newSubGuestPassport"
                    value={current.passportData}
                    onChange={(e) =>
                      setNewBookingSubGuests((prev) =>
                        prev.map((x) => (x.id === current.id ? { ...x, passportData: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={current.isChild}
                    onChange={(e) =>
                      setNewBookingSubGuests((prev) =>
                        prev.map((x) =>
                          x.id === current.id
                            ? {
                                ...x,
                                isChild: e.target.checked,
                                age: e.target.checked ? x.age : '',
                                birthCertificate: e.target.checked ? x.birthCertificate : '',
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  Ребенок
                </label>
                {current.isChild ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="newSubGuestAge">Возраст</Label>
                      <Input
                        id="newSubGuestAge"
                        type="number"
                        min={0}
                        value={current.age}
                        onChange={(e) =>
                          setNewBookingSubGuests((prev) =>
                            prev.map((x) => (x.id === current.id ? { ...x, age: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="newSubGuestBirthCertificate">Свидетельство о рождении</Label>
                      <Input
                        id="newSubGuestBirthCertificate"
                        value={current.birthCertificate}
                        onChange={(e) =>
                          setNewBookingSubGuests((prev) =>
                            prev.map((x) =>
                              x.id === current.id ? { ...x, birthCertificate: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button type="button" onClick={() => setNewBookingSubGuestsDialogOpen(false)}>
                    Сохранить
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default HomePage
