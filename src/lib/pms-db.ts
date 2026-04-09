import { format } from 'date-fns'
import type { User } from '@supabase/supabase-js'

import {
  checkInTimeToDb,
  checkOutTimeToDb,
  normalizeCheckInTime,
} from '@/lib/booking-check-in-time'
import { normalizeRole } from '@/lib/access'
import { getSupabase } from '@/lib/supabase'
import type {
  Booking,
  BookingSource,
  Citizenship,
  Guest,
  GuestPaymentMethod,
  PublicUser,
  Room,
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

type GuestRow = {
  id: string
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
  payment_method: string
  approve: boolean
  checked_in_at?: string | null
  checked_out_at?: string | null
}

type BookingRow = {
  id: string
  room_id: string
  guest_name: string
  start_date: string
  end_date: string
  check_in_time?: string | null
  check_out_time?: string | null
  note: string | null
  guest_id: string | null
  booking_source_id?: number | null
}

type NoteRow = {
  id: string
  body: string
  room_id: string | null
  guest_id: string | null
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

function guestRowToModel(row: GuestRow): Guest {
  const today = format(new Date(), 'yyyy-MM-dd')
  const startDate = row.start_date ?? today
  const endDate = row.end_date ?? today
  const createdAtFallback = `${startDate}T00:00:00.000Z`
  return {
    id: row.id,
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
    payment_method: g.paymentMethod,
    approve: g.aprove ?? false,
    checked_in_at: g.checkedInAt ?? null,
    checked_out_at: g.checkedOutAt ?? null,
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
    checkInTime: cit,
    checkOutTime: cot,
    note: row.note ?? undefined,
    guestId: row.guest_id ?? undefined,
    bookingSourceId: row.booking_source_id ?? null,
  }
}

function bookingToRow(b: Booking): BookingRow {
  return {
    id: b.id,
    room_id: b.roomId,
    guest_name: b.guestName,
    start_date: b.startDate,
    end_date: b.endDate,
    check_in_time: checkInTimeToDb(b.checkInTime),
    check_out_time: checkOutTimeToDb(b.checkOutTime),
    note: b.note ?? null,
    guest_id: b.guestId ?? null,
    booking_source_id: b.bookingSourceId ?? null,
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
  deadlineAt?: string | null
  createdByUserId?: string | null
  createdByName?: string | null
}

export async function insertStickyNote(input: StickyNoteInput): Promise<StickyNote> {
  const sb = getSupabase()
  const id = crypto.randomUUID()
  const row = {
    id,
    body: input.body.trim(),
    room_id: input.roomId?.trim() || null,
    guest_id: input.guestId?.trim() || null,
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

export async function fetchGuests(): Promise<Guest[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('guests').select('*')
  if (error) throw error
  return (data as GuestRow[]).map(guestRowToModel)
}

export async function fetchGuestById(id: string): Promise<Guest | undefined> {
  const sb = getSupabase()
  const { data, error } = await sb.from('guests').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return undefined
  return guestRowToModel(data as GuestRow)
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
