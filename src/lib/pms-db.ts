import { format } from 'date-fns'
import type { User } from '@supabase/supabase-js'

import {
  checkInTimeToDb,
  checkOutTimeToDb,
  normalizeCheckInTime,
} from '@/lib/booking-check-in-time'
import { normalizeRole } from '@/lib/access'
import { getSupabase } from '@/lib/supabase'
import { randomUUID } from '@/lib/utils'
import type {
  AdditionalService,
  BookingAdditionalService,
  BookingSubGuest,
  Booking,
  BookingSource,
  Citizenship,
  DayOfWeek,
  GuestProfile,
  Guest,
  GuestPaymentMethod,
  PaymentStatus,
  PublicUser,
  RoomDailyPrice,
  RoomSpecialPriceCondition,
  RoomClosure,
  Room,
  RoomCategory,
  RoomCleaningStatus,
  StickyNote,
} from '@/types/models'

type ProfileRow = {
  id: string
  email: string
  username: string
  role: string
  can_manage_users: boolean
  full_access: boolean
}

type RoomRow = {
  id: string
  name: string
  capacity: number
  category: string | null
  cleaning_status?: string | null
  cleaning_updated_at?: string | null
  cleaning_updated_by?: string | null
  cleaning_updated_by_label?: string | null
}

type RoomDailyPriceRow = {
  room_id: string
  day_of_week: number
  price: number
}

type RoomCategoryRow = {
  name: string
  weekday_price: number
  weekend_price: number
}

type RoomSpecialPriceConditionRow = {
  id: string
  room_id: string
  title: string
  start_at: string
  end_at: string
}

type RoomSpecialPriceConditionPriceRow = {
  condition_id: string
  day_of_week: number
  price: number
}

type RoomClosureRow = {
  id: string
  room_id: string
  start_at: string
  end_at: string
  reason: string
  created_by_user_id: string | null
  created_by_name: string | null
  repair_completed_at: string | null
  resolved_issues: string | null
  repaired_by_user_id: string | null
  repaired_by_name: string | null
  checked_at: string | null
  checked_by_user_id: string | null
  checked_by_name: string | null
  checked_by_role: string | null
  checked_comment: string | null
  assigned_technician_user_id: string | null
  assigned_technician_name: string | null
}

type GuestRow = {
  id: string
  profile_id?: string | null
  first_name: string
  last_name: string
  middle_name?: string | null
  citizenship_id?: number | null
  phone?: string | null
  email?: string | null
  room_id: string
  start_date: string
  end_date: string
  created_at: string
  payment_status?: string | null
  payment_method: string
  approve: boolean
  checked_in_at?: string | null
  checked_out_at?: string | null
}

type GuestProfileRow = {
  id: string
  first_name: string
  last_name: string
  middle_name?: string | null
  citizenship_id?: number | null
  phone?: string | null
  email?: string | null
}

type BookingRow = {
  id: string
  room_id: string
  guest_name: string
  start_date: string
  end_date: string
  total_price?: number | null
  check_in_time?: string | null
  check_out_time?: string | null
  note: string | null
  guest_id: string | null
  booking_source_id?: number | null
  guests_count?: number | null
  children_count?: number | null
  payment_status?: string | null
}

type AdditionalServiceRow = {
  id: string
  name: string
  price: number
}

type BookingAdditionalServiceRow = {
  booking_id: string
  service_id: string
  quantity: number
  unit_price: number
  additional_services?:
    | {
        name: string
      }[]
    | {
        name: string
      }
    | null
}

type BookingSubGuestRow = {
  id: string
  booking_id: string
  position: number
  last_name: string
  first_name: string
  middle_name: string | null
  passport_data: string | null
  is_child: boolean
  age: number | null
  birth_certificate: string | null
}

function isDayOfWeek(value: number): value is DayOfWeek {
  return Number.isInteger(value) && value >= 0 && value <= 6
}

const ALL_WEEK_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6]

type NoteRow = {
  id: string
  body: string
  room_id: string | null
  guest_id: string | null
  booking_sub_guest_id?: string | null
  deadline_at: string | null
  created_by_user_id: string | null
  created_by_name: string | null
  is_completed: boolean
  completed_at: string | null
  completed_by_user_id: string | null
  completed_by_name: string | null
  deleted_at: string | null
  deleted_by_user_id: string | null
  deleted_by_name: string | null
  created_at: string
  updated_at: string
}

function noteRowToModel(row: NoteRow): StickyNote {
  return {
    id: row.id,
    body: row.body,
    roomId: row.room_id,
    guestId: row.guest_id,
    bookingSubGuestId: row.booking_sub_guest_id ?? null,
    deadlineAt: row.deadline_at,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    completedByUserId: row.completed_by_user_id,
    completedByName: row.completed_by_name,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
    deletedByName: row.deleted_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function profileRowToPublic(row: ProfileRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: normalizeRole(row.role),
    canManageUsers: row.can_manage_users,
    fullAccess: row.full_access,
  }
}

/**
 * Если строки в public.profiles ещё нет (миграция, сбой триггера), строим профиль из JWT/session,
 * чтобы вход в админку не «обнулялся» после успешного signInWithPassword.
 */
export function publicUserFromAuthUser(u: User): PublicUser {
  const email = u.email ?? ''
  const meta = { ...(u.user_metadata ?? {}), ...(u.app_metadata ?? {}) } as Record<string, unknown>
  const usernameRaw = meta.username ?? meta.name ?? email.split('@')[0] ?? 'user'
  const username = String(usernameRaw).trim() || 'user'
  const roleStr = typeof meta.role === 'string' ? meta.role : 'concierge'
  const role = normalizeRole(roleStr)
  return {
    id: u.id,
    email,
    username,
    role,
    canManageUsers: Boolean(meta.can_manage_users ?? meta.canManageUsers),
    fullAccess: Boolean(meta.full_access ?? meta.fullAccess),
  }
}

/** Профиль из БД или запасной вариант из объекта пользователя Auth. */
export async function fetchProfileOrFallback(authUser: User): Promise<PublicUser> {
  try {
    const p = await fetchProfileByUserId(authUser.id)
    if (p) return p
  } catch {
    /* RLS / сеть — ниже fallback */
  }
  return publicUserFromAuthUser(authUser)
}

function parseCleaningStatus(v: string | null | undefined): RoomCleaningStatus | null {
  if (v === 'clean' || v === 'dirty') return v
  return null
}

function roomRowToModel(row: RoomRow): Room {
  const label = row.cleaning_updated_by_label?.trim()
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    category: row.category ?? 'Без категории',
    cleaningStatus: parseCleaningStatus(row.cleaning_status ?? null),
    cleaningUpdatedAt: row.cleaning_updated_at ?? null,
    cleaningUpdatedById: row.cleaning_updated_by ?? null,
    cleaningUpdatedByDisplay: label || null,
  }
}

function roomToRow(r: Room): RoomRow {
  return {
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    category: (r.category ?? '').trim() || null,
    cleaning_status: r.cleaningStatus ?? null,
    cleaning_updated_at: r.cleaningUpdatedAt ?? null,
    cleaning_updated_by: r.cleaningUpdatedById ?? null,
    cleaning_updated_by_label: r.cleaningUpdatedByDisplay ?? null,
  }
}

function parsePaymentStatus(raw: string | null | undefined): PaymentStatus {
  return raw === 'paid' ? 'paid' : 'unpaid'
}

function guestRowToModel(row: GuestRow): Guest {
  const today = format(new Date(), 'yyyy-MM-dd')
  const startDate = row.start_date ?? today
  const endDate = row.end_date ?? today
  const createdAtFallback = `${startDate}T00:00:00.000Z`
  return {
    id: row.id,
    profileId: row.profile_id ?? null,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name?.trim() ? row.middle_name : null,
    citizenshipId: row.citizenship_id ?? null,
    phone: row.phone?.trim() ? row.phone : null,
    email: row.email?.trim() ? row.email : null,
    roomId: row.room_id,
    startDate,
    endDate,
    createdAt: row.created_at ?? createdAtFallback,
    paymentStatus: parsePaymentStatus(row.payment_status),
    paymentMethod: (row.payment_method as GuestPaymentMethod) ?? 'unpaid',
    aprove: row.approve ?? false,
    checkedInAt: row.checked_in_at ?? null,
    checkedOutAt: row.checked_out_at ?? null,
  }
}

function guestToRow(g: Guest): GuestRow {
  const mid = g.middleName?.trim()
  return {
    id: g.id,
    profile_id: g.profileId ?? null,
    first_name: g.firstName,
    last_name: g.lastName,
    middle_name: mid ? mid : null,
    citizenship_id: g.citizenshipId ?? null,
    phone: g.phone?.trim() ? g.phone.trim() : null,
    email: g.email?.trim() ? g.email.trim() : null,
    room_id: g.roomId,
    start_date: g.startDate,
    end_date: g.endDate,
    created_at: g.createdAt,
    payment_status: g.paymentStatus,
    payment_method: g.paymentMethod,
    approve: g.aprove ?? false,
    checked_in_at: g.checkedInAt ?? null,
    checked_out_at: g.checkedOutAt ?? null,
  }
}

function guestProfileRowToModel(row: GuestProfileRow): GuestProfile {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name?.trim() ? row.middle_name : null,
    citizenshipId: row.citizenship_id ?? null,
    phone: row.phone?.trim() ? row.phone : null,
    email: row.email?.trim() ? row.email : null,
  }
}

function bookingRowToModel(row: BookingRow): Booking {
  const cit =
    row.check_in_time != null && String(row.check_in_time).trim() !== ''
      ? normalizeCheckInTime(String(row.check_in_time))
      : undefined
  const cot =
    row.check_out_time != null && String(row.check_out_time).trim() !== ''
      ? normalizeCheckInTime(String(row.check_out_time))
      : undefined
  return {
    id: row.id,
    roomId: row.room_id,
    guestName: row.guest_name,
    startDate: row.start_date,
    endDate: row.end_date,
    paymentStatus: parsePaymentStatus(row.payment_status),
    totalPrice: row.total_price ?? null,
    checkInTime: cit,
    checkOutTime: cot,
    note: row.note ?? undefined,
    guestId: row.guest_id ?? undefined,
    bookingSourceId: row.booking_source_id ?? null,
    guestsCount: row.guests_count ?? 1,
    childrenCount: row.children_count ?? 0,
  }
}

function bookingToRow(b: Booking): BookingRow {
  return {
    id: b.id,
    room_id: b.roomId,
    guest_name: b.guestName,
    start_date: b.startDate,
    end_date: b.endDate,
    payment_status: b.paymentStatus,
    total_price: b.totalPrice ?? null,
    check_in_time: checkInTimeToDb(b.checkInTime),
    check_out_time: checkOutTimeToDb(b.checkOutTime),
    note: b.note ?? null,
    guest_id: b.guestId ?? null,
    booking_source_id: b.bookingSourceId ?? null,
    guests_count: b.guestsCount ?? 1,
    children_count: b.childrenCount ?? 0,
  }
}

export async function fetchRooms(): Promise<Room[]> {
  const sb = getSupabase()
  const { error: checkoutRpcError } = await sb.rpc('apply_dirty_rooms_after_guest_checkout')
  if (checkoutRpcError && import.meta.env.DEV) {
    console.warn(
      '[fetchRooms] apply_dirty_rooms_after_guest_checkout:',
      checkoutRpcError.message,
    )
  }
  const { data, error } = await sb.from('rooms').select('*').order('name')
  if (error) throw error
  return (data as RoomRow[]).map(roomRowToModel)
}

export async function fetchRoomDailyPrices(): Promise<RoomDailyPrice[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('room_daily_prices')
    .select('room_id, day_of_week, price')
    .order('room_id')
    .order('day_of_week')
  if (error) throw error
  return (data as RoomDailyPriceRow[])
    .filter((row) => isDayOfWeek(row.day_of_week))
    .map((row) => ({
      roomId: row.room_id,
      dayOfWeek: row.day_of_week as DayOfWeek,
      price: row.price,
    }))
}

export async function fetchRoomCategories(): Promise<RoomCategory[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('room_categories')
    .select('name, weekday_price, weekend_price')
    .order('name')
  if (error) throw error
  return (data as RoomCategoryRow[]).map((row) => ({
    name: row.name,
    weekdayPrice: row.weekday_price,
    weekendPrice: row.weekend_price,
  }))
}

export async function upsertRoomCategory(category: RoomCategory): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('room_categories').upsert({
    name: category.name.trim(),
    weekday_price: category.weekdayPrice,
    weekend_price: category.weekendPrice,
  })
  if (error) throw error
}

export async function deleteRoomCategory(name: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('room_categories').delete().eq('name', name)
  if (error) throw error
}

export async function setRoomDailyPrices(roomId: string, prices: Record<DayOfWeek, number>): Promise<void> {
  const sb = getSupabase()
  const rows = (Object.entries(prices) as [string, number][])
    .map(([dayOfWeek, price]) => ({
      room_id: roomId,
      day_of_week: Number(dayOfWeek),
      price: Number(price),
    }))
    .filter((row) => isDayOfWeek(row.day_of_week) && Number.isFinite(row.price) && row.price >= 0)
  const { error: delError } = await sb.from('room_daily_prices').delete().eq('room_id', roomId)
  if (delError) throw delError
  if (rows.length === 0) return
  const { error } = await sb.from('room_daily_prices').insert(rows)
  if (error) throw error
}

export async function fetchRoomSpecialPriceConditions(): Promise<RoomSpecialPriceCondition[]> {
  const sb = getSupabase()
  const [{ data: conditions, error: conditionsError }, { data: prices, error: pricesError }] =
    await Promise.all([
      sb
        .from('room_special_price_conditions')
        .select('id, room_id, title, start_at, end_at')
        .order('room_id')
        .order('start_at'),
      sb
        .from('room_special_price_condition_prices')
        .select('condition_id, day_of_week, price'),
    ])
  if (conditionsError) throw conditionsError
  if (pricesError) throw pricesError
  const pricesByConditionId = new Map<string, Partial<Record<DayOfWeek, number>>>()
  ;(prices as RoomSpecialPriceConditionPriceRow[]).forEach((row) => {
    if (!isDayOfWeek(row.day_of_week)) return
    const current = pricesByConditionId.get(row.condition_id) ?? {}
    current[row.day_of_week] = row.price
    pricesByConditionId.set(row.condition_id, current)
  })
  return (conditions as RoomSpecialPriceConditionRow[]).map((row) => {
    const defaults: Record<DayOfWeek, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    const roomPrices = pricesByConditionId.get(row.id) ?? {}
    ALL_WEEK_DAYS.forEach((dayOfWeek) => {
      const value = roomPrices[dayOfWeek]
      if (typeof value === 'number' && Number.isFinite(value)) defaults[dayOfWeek] = value
    })
    return {
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      startAt: row.start_at,
      endAt: row.end_at,
      prices: defaults,
    }
  })
}

export async function setRoomSpecialPriceConditions(
  roomId: string,
  conditions: Omit<RoomSpecialPriceCondition, 'roomId'>[],
): Promise<void> {
  const sb = getSupabase()
  const existingIdsResp = await sb
    .from('room_special_price_conditions')
    .select('id')
    .eq('room_id', roomId)
  if (existingIdsResp.error) throw existingIdsResp.error
  const existingIds = (existingIdsResp.data ?? []).map((x: { id: string }) => x.id)
  if (existingIds.length > 0) {
    const { error: delPriceError } = await sb
      .from('room_special_price_condition_prices')
      .delete()
      .in('condition_id', existingIds)
    if (delPriceError) throw delPriceError
    const { error: delCondError } = await sb
      .from('room_special_price_conditions')
      .delete()
      .eq('room_id', roomId)
    if (delCondError) throw delCondError
  }
  if (conditions.length === 0) return
  const normalized = conditions.map((item) => ({
    id: item.id,
    room_id: roomId,
    title: item.title.trim(),
    start_at: item.startAt,
    end_at: item.endAt,
  }))
  const { error: insertCondError } = await sb.from('room_special_price_conditions').insert(normalized)
  if (insertCondError) throw insertCondError
  const priceRows = conditions.flatMap((item) =>
    (Object.entries(item.prices) as [string, number][])
      .map(([dayOfWeek, price]) => ({
        condition_id: item.id,
        day_of_week: Number(dayOfWeek),
        price: Number(price),
      }))
      .filter((row) => isDayOfWeek(row.day_of_week) && Number.isFinite(row.price) && row.price >= 0),
  )
  if (priceRows.length === 0) return
  const { error: insertPriceError } = await sb.from('room_special_price_condition_prices').insert(priceRows)
  if (insertPriceError) throw insertPriceError
}

export async function fetchRoomClosures(): Promise<RoomClosure[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('room_closures')
    .select(
      'id, room_id, start_at, end_at, reason, created_by_user_id, created_by_name, repair_completed_at, resolved_issues, repaired_by_user_id, repaired_by_name, checked_at, checked_by_user_id, checked_by_name, checked_by_role, checked_comment, assigned_technician_user_id, assigned_technician_name',
    )
    .order('room_id')
    .order('start_at')
  if (error) throw error
  return (data as RoomClosureRow[]).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason ?? '',
    createdByUserId: row.created_by_user_id ?? null,
    createdByName: row.created_by_name ?? null,
    repairCompletedAt: row.repair_completed_at ?? null,
    resolvedIssues: row.resolved_issues ?? null,
    repairedByUserId: row.repaired_by_user_id ?? null,
    repairedByName: row.repaired_by_name ?? null,
    checkedAt: row.checked_at ?? null,
    checkedByUserId: row.checked_by_user_id ?? null,
    checkedByName: row.checked_by_name ?? null,
    checkedByRole: row.checked_by_role ?? null,
    checkedComment: row.checked_comment ?? null,
    assignedTechnicianUserId: row.assigned_technician_user_id ?? null,
    assignedTechnicianName: row.assigned_technician_name ?? null,
  }))
}

export async function setRoomClosures(roomId: string, closures: Omit<RoomClosure, 'roomId'>[]): Promise<void> {
  const sb = getSupabase()
  const { error: delError } = await sb.from('room_closures').delete().eq('room_id', roomId)
  if (delError) throw delError
  if (closures.length === 0) return
  const rows = closures.map((item) => ({
    id: item.id,
    room_id: roomId,
    start_at: item.startAt,
    end_at: item.endAt,
    reason: item.reason.trim(),
    created_by_user_id: item.createdByUserId ?? null,
    created_by_name: item.createdByName ?? null,
    repair_completed_at: item.repairCompletedAt ?? null,
    resolved_issues: item.resolvedIssues?.trim() || null,
    repaired_by_user_id: item.repairedByUserId ?? null,
    repaired_by_name: item.repairedByName ?? null,
    checked_at: item.checkedAt ?? null,
    checked_by_user_id: item.checkedByUserId ?? null,
    checked_by_name: item.checkedByName ?? null,
    checked_by_role: item.checkedByRole ?? null,
    checked_comment: item.checkedComment?.trim() || null,
    assigned_technician_user_id: item.assignedTechnicianUserId ?? null,
    assigned_technician_name: item.assignedTechnicianName?.trim() || null,
  }))
  const { error } = await sb.from('room_closures').insert(rows)
  if (error) throw error
}

export type RoomCleaningAudit = {
  cleaningUpdatedAt: string | null
  cleaningUpdatedById: string | null
  cleaningUpdatedByDisplay: string | null
}

export async function updateRoomCleaningStatus(
  roomId: string,
  status: RoomCleaningStatus | null,
): Promise<RoomCleaningAudit> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('rooms')
    .update({ cleaning_status: status })
    .eq('id', roomId)
    .select('cleaning_updated_at, cleaning_updated_by, cleaning_updated_by_label')
    .single()
  if (error) throw error
  const row = data as Pick<
    RoomRow,
    'cleaning_updated_at' | 'cleaning_updated_by' | 'cleaning_updated_by_label'
  >
  return {
    cleaningUpdatedAt: row.cleaning_updated_at ?? null,
    cleaningUpdatedById: row.cleaning_updated_by ?? null,
    cleaningUpdatedByDisplay: row.cleaning_updated_by_label?.trim() || null,
  }
}

/**
 * События INSERT/UPDATE/DELETE по `public.rooms` (в т.ч. статус уборки).
 * В Supabase должна быть включена replication для таблицы `rooms` (миграция или Dashboard → Database → Replication).
 */
export function subscribeRoomsRealtime(onUpdate: () => void): () => void {
  const sb = getSupabase()
  const channel = sb
    .channel('mypms-rooms-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
      onUpdate()
    })
    .subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}

/** События INSERT/UPDATE/DELETE по `public.room_closures`. */
export function subscribeRoomClosuresRealtime(onUpdate: () => void): () => void {
  const sb = getSupabase()
  const channel = sb
    .channel('mypms-room-closures-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_closures' }, () => {
      onUpdate()
    })
    .subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}

export async function fetchStickyNotes(): Promise<StickyNote[]> {
  const sb = getSupabase()
  const { error: cleanupError } = await sb.rpc('cleanup_completed_notes')
  if (cleanupError && import.meta.env.DEV) {
    console.warn('[fetchStickyNotes] cleanup_completed_notes:', cleanupError.message)
  }
  const { data, error } = await sb
    .from('notes')
    .select('*')
    .eq('is_completed', false)
    .is('deleted_at', null)
  if (error) throw error
  const list = (data as NoteRow[]).map(noteRowToModel)
  return list.sort((a, b) => {
    const da = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.POSITIVE_INFINITY
    const db = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

export async function fetchCompletedStickyNotes(): Promise<StickyNote[]> {
  const sb = getSupabase()
  const { error: cleanupError } = await sb.rpc('cleanup_completed_notes')
  if (cleanupError && import.meta.env.DEV) {
    console.warn('[fetchCompletedStickyNotes] cleanup_completed_notes:', cleanupError.message)
  }
  const { data, error } = await sb
    .from('notes')
    .select('*')
    .eq('is_completed', true)
    .is('deleted_at', null)
    .order('completed_at', { ascending: false })
  if (error) throw error
  return (data as NoteRow[]).map(noteRowToModel)
}

export async function fetchPendingDeletionStickyNotes(): Promise<StickyNote[]> {
  const sb = getSupabase()
  const { error: cleanupError } = await sb.rpc('cleanup_completed_notes')
  if (cleanupError && import.meta.env.DEV) {
    console.warn('[fetchPendingDeletionStickyNotes] cleanup_completed_notes:', cleanupError.message)
  }
  const { data, error } = await sb
    .from('notes')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data as NoteRow[]).map(noteRowToModel)
}

export type StickyNoteInput = {
  body: string
  roomId?: string | null
  guestId?: string | null
  bookingSubGuestId?: string | null
  deadlineAt?: string | null
  createdByUserId?: string | null
  createdByName?: string | null
}

export async function insertStickyNote(input: StickyNoteInput): Promise<StickyNote> {
  const sb = getSupabase()
  const id = randomUUID()
  const row = {
    id,
    body: input.body.trim(),
    room_id: input.roomId?.trim() || null,
    guest_id: input.guestId?.trim() || null,
    booking_sub_guest_id: input.bookingSubGuestId?.trim() || null,
    deadline_at: input.deadlineAt?.trim() || null,
    created_by_user_id: input.createdByUserId?.trim() || null,
    created_by_name: input.createdByName?.trim() || null,
  }
  const { data, error } = await sb.from('notes').insert(row).select('*').single()
  if (error) throw error
  return noteRowToModel(data as NoteRow)
}

export async function updateStickyNote(
  id: string,
  input: StickyNoteInput,
): Promise<StickyNote> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('notes')
    .update({
      body: input.body.trim(),
      room_id: input.roomId?.trim() || null,
      guest_id: input.guestId?.trim() || null,
      booking_sub_guest_id: input.bookingSubGuestId?.trim() || null,
      deadline_at: input.deadlineAt?.trim() || null,
      is_completed: false,
      completed_at: null,
      completed_by_user_id: null,
      completed_by_name: null,
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return noteRowToModel(data as NoteRow)
}

/** Только текст: не трогает выполнение, удаление, номер, гостя и дедлайн. */
export async function updateStickyNoteBody(id: string, body: string): Promise<StickyNote> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('notes')
    .update({ body: body.trim() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return noteRowToModel(data as NoteRow)
}

export type StickyNoteActor = {
  userId: string
  userName: string
}

export async function markStickyNoteCompleted(
  id: string,
  actor: StickyNoteActor,
): Promise<StickyNote> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('notes')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      completed_by_user_id: actor.userId.trim(),
      completed_by_name: actor.userName.trim(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return noteRowToModel(data as NoteRow)
}

/** С главной: мягкое удаление (строка остаётся в БД до автоочистки через 7 дней). */
export async function softDeleteStickyNoteFromHome(
  id: string,
  actor: StickyNoteActor,
): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb
    .from('notes')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: actor.userId.trim(),
      deleted_by_name: actor.userName.trim(),
    })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw error
}

/** Окончательное удаление из БД (страница «Заметки» и истёкшие записи чистит RPC). */
export async function purgeStickyNote(id: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('notes').delete().eq('id', id)
  if (error) throw error
}

export function subscribeNotesRealtime(onUpdate: () => void): () => void {
  const sb = getSupabase()
  const channel = sb
    .channel('mypms-notes-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => {
      onUpdate()
    })
    .subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}

export async function fetchBookings(): Promise<Booking[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('bookings').select('*')
  if (error) throw error
  return (data as BookingRow[]).map(bookingRowToModel)
}

export async function fetchCitizenships(): Promise<Citizenship[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('citizenships').select('id, name').order('name')
  if (error) throw error
  return (data as { id: number; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
}

export async function fetchBookingSources(): Promise<BookingSource[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('booking_sources').select('id, name').order('id')
  if (error) throw error
  return (data as { id: number; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
}

export async function fetchAdditionalServices(): Promise<AdditionalService[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('additional_services')
    .select('id, name, price')
    .order('name')
  if (error) throw error
  return (data as AdditionalServiceRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
  }))
}

export async function upsertAdditionalService(service: AdditionalService): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('additional_services').upsert({
    id: service.id,
    name: service.name.trim(),
    price: service.price,
  })
  if (error) throw error
}

export async function deleteAdditionalService(id: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('additional_services').delete().eq('id', id)
  if (error) throw error
}

export async function fetchBookingAdditionalServices(): Promise<BookingAdditionalService[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('booking_additional_services')
    .select('booking_id, service_id, quantity, unit_price, additional_services(name)')
  if (error) throw error
  return (data as BookingAdditionalServiceRow[]).map((row) => ({
    bookingId: row.booking_id,
    serviceId: row.service_id,
    serviceName: Array.isArray(row.additional_services)
      ? (row.additional_services[0]?.name ?? 'Услуга')
      : (row.additional_services?.name ?? 'Услуга'),
    quantity: row.quantity,
    unitPrice: row.unit_price,
  }))
}

export async function fetchBookingSubGuests(): Promise<BookingSubGuest[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('booking_sub_guests')
    .select(
      'id, booking_id, position, last_name, first_name, middle_name, passport_data, is_child, age, birth_certificate',
    )
    .order('booking_id')
    .order('position')
  if (error) throw error
  return (data as BookingSubGuestRow[]).map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    position: row.position,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name ?? null,
    passportData: row.passport_data ?? null,
    isChild: row.is_child,
    age: row.age ?? null,
    birthCertificate: row.birth_certificate ?? null,
  }))
}

export async function setBookingSubGuests(
  bookingId: string,
  guests: Omit<BookingSubGuest, 'bookingId'>[],
): Promise<void> {
  const sb = getSupabase()
  const { error: delError } = await sb
    .from('booking_sub_guests')
    .delete()
    .eq('booking_id', bookingId)
  if (delError) throw delError
  if (guests.length === 0) return
  const rows = guests.map((item) => ({
    id: item.id,
    booking_id: bookingId,
    position: item.position,
    last_name: item.lastName.trim(),
    first_name: item.firstName.trim(),
    middle_name: item.middleName?.trim() || null,
    passport_data: item.passportData?.trim() || null,
    is_child: item.isChild,
    age: item.isChild && item.age != null ? item.age : null,
    birth_certificate: item.isChild ? item.birthCertificate?.trim() || null : null,
  }))
  const { error } = await sb.from('booking_sub_guests').insert(rows)
  if (error) throw error
}

export async function setBookingAdditionalServices(
  bookingId: string,
  items: Array<{ serviceId: string; quantity: number; unitPrice: number }>,
): Promise<void> {
  const sb = getSupabase()
  const { error: delError } = await sb.from('booking_additional_services').delete().eq('booking_id', bookingId)
  if (delError) throw delError
  if (items.length === 0) return
  const rows = items
    .map((item) => ({
      booking_id: bookingId,
      service_id: item.serviceId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
    }))
    .filter((item) => item.quantity > 0 && item.unit_price >= 0)
  if (rows.length === 0) return
  const { error } = await sb.from('booking_additional_services').insert(rows)
  if (error) throw error
}

export async function fetchGuests(): Promise<Guest[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('guests').select('*')
  if (error) throw error
  return (data as GuestRow[]).map(guestRowToModel)
}

export async function fetchGuestProfiles(): Promise<GuestProfile[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('guest_profiles').select('*')
  if (error) throw error
  return (data as GuestProfileRow[]).map(guestProfileRowToModel)
}

export async function upsertGuestProfile(profile: GuestProfile): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('guest_profiles').upsert({
    id: profile.id,
    first_name: profile.firstName.trim(),
    last_name: profile.lastName.trim(),
    middle_name: profile.middleName?.trim() || null,
    citizenship_id: profile.citizenshipId ?? null,
    phone: profile.phone?.trim() || null,
    email: profile.email?.trim() || null,
  })
  if (error) throw error
}

export async function fetchGuestById(id: string): Promise<Guest | undefined> {
  const sb = getSupabase()
  const { data, error } = await sb.from('guests').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return undefined
  return guestRowToModel(data as GuestRow)
}

/** Удалить карточку гостя и все брони с этим guest_id (субгости и услуги — каскадом с бронью). Заметки по guest_id удаляются вместе с гостем. */
export async function deleteGuestById(guestId: string): Promise<void> {
  const sb = getSupabase()
  const { error: bErr } = await sb.from('bookings').delete().eq('guest_id', guestId)
  if (bErr) throw bErr
  const { error: gErr } = await sb.from('guests').delete().eq('id', guestId)
  if (gErr) throw gErr
}

/** Обновить статус оплаты у гостя и всех связанных броней (guest_id). */
export async function patchGuestAndLinkedBookingsPayment(
  guestId: string,
  paymentStatus: PaymentStatus,
  channel: Exclude<GuestPaymentMethod, 'unpaid'>,
): Promise<void> {
  const sb = getSupabase()
  const payment_method: GuestPaymentMethod = paymentStatus === 'unpaid' ? 'unpaid' : channel
  const { error: e1 } = await sb
    .from('guests')
    .update({ payment_status: paymentStatus, payment_method })
    .eq('id', guestId)
  if (e1) throw e1
  const { error: e2 } = await sb.from('bookings').update({ payment_status: paymentStatus }).eq('guest_id', guestId)
  if (e2) throw e2
}

/** Бронь с guest_id (если несколько — с самым поздним start_date). */
export async function fetchBookingByGuestId(guestId: string): Promise<Booking | null> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('bookings')
    .select('*')
    .eq('guest_id', guestId)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return bookingRowToModel(data as BookingRow)
}

export async function fetchProfiles(): Promise<PublicUser[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('profiles').select('*').order('username')
  if (error) throw error
  return (data as ProfileRow[]).map(profileRowToPublic)
}

/** Пользователи с ролью «техник» (назначение на ремонт). */
export async function fetchTechnicians(): Promise<PublicUser[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('profiles').select('*').eq('role', 'technician').order('username')
  if (error) throw error
  return (data as ProfileRow[]).map(profileRowToPublic)
}

export async function fetchProfileByUserId(userId: string): Promise<PublicUser | null> {
  const sb = getSupabase()
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return profileRowToPublic(data as ProfileRow)
}

async function syncTable<T extends { id: string }>(
  table: 'rooms' | 'guests' | 'bookings',
  rows: T[],
  toRow: (x: T) => Record<string, unknown>,
): Promise<void> {
  const sb = getSupabase()
  const { data: existing, error: selErr } = await sb.from(table).select('id')
  if (selErr) throw selErr
  const nextIds = new Set(rows.map((r) => r.id))
  const toDelete = (existing ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !nextIds.has(id))
  // Сначала upsert, потом удаление «лишних»: иначе при ошибке upsert строки уже стёрты — таблица на время пустая или битая.
  if (rows.length > 0) {
    const { error: upErr } = await sb.from(table).upsert(rows.map(toRow) as never[], {
      onConflict: 'id',
    })
    if (upErr) throw upErr
  }
  if (toDelete.length > 0) {
    const { error: delErr } = await sb.from(table).delete().in('id', toDelete)
    if (delErr) throw delErr
  }
}

export async function syncRooms(rooms: Room[]): Promise<void> {
  const normalized = rooms.map((r) => ({
    ...r,
    category: (r.category ?? '').trim() || 'Без категории',
  }))
  await syncTable('rooms', normalized, (x) => roomToRow(x as Room))
}

export async function syncGuests(guests: Guest[]): Promise<void> {
  await syncTable('guests', guests, (x) => guestToRow(x as Guest))
}

export async function syncBookings(bookings: Booking[]): Promise<void> {
  await syncTable('bookings', bookings, (x) => bookingToRow(x as Booking))
}

/** Сохранить гостей и брони в правильном порядке (FK guest_id). */
export async function syncGuestsAndBookings(
  guests: Guest[],
  bookings: Booking[],
): Promise<void> {
  await syncGuests(guests)
  await syncBookings(bookings)
}
