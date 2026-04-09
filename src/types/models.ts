/** Заметка-стикер на главной / привязка к гостю в шахматке */
export interface StickyNote {
  id: string
  body: string
  roomId?: string | null
  guestId?: string | null
  deadlineAt?: string | null
  createdAt: string
  updatedAt: string
}

/** Отметка уборки на странице «Уборка в номерах» */
export type RoomCleaningStatus = 'clean' | 'dirty'

export interface Room {
  id: string
  name: string
  capacity: number
  /** Группа на шахматке (дом / корпус) */
  category?: string
  /** NULL / отсутствует — отметки нет */
  cleaningStatus?: RoomCleaningStatus | null
  /** ISO 8601 — когда последний раз меняли статус уборки */
  cleaningUpdatedAt?: string | null
  /** id из profiles (для upsert при синхронизации номеров) */
  cleaningUpdatedById?: string | null
  /** Имя пользователя или email из profiles (только чтение, из join) */
  cleaningUpdatedByDisplay?: string | null
}

export interface Booking {
  id: string
  roomId: string
  guestName: string
  startDate: string
  endDate: string
  /** Время заезда в день startDate (HH:mm, локально); без поля — с полуночи */
  checkInTime?: string | null
  /** Время выезда в день endDate (HH:mm); без поля — до конца дня выезда */
  checkOutTime?: string | null
  note?: string
  /** Связь с записью в таблице Guest (имя, подтверждение заезда) */
  guestId?: string
  /** Источник брони (booking_sources.id) */
  bookingSourceId?: number | null
}

/** Строка справочника гражданств (таблица citizenships). */
export interface Citizenship {
  id: number
  name: string
}

/** Строка справочника источников брони (таблица booking_sources). */
export interface BookingSource {
  id: number
  name: string
}

/** Способ оплаты в карточке гостя (таблица Guest) */
export type GuestPaymentMethod = 'cash' | 'transfer' | 'unpaid'

/** Роль в профиле: админ, консьерж (брони/гости), уборщица (номера). Устаревшее staff в БД приводится к concierge. */
export type UserRole = 'admin' | 'concierge' | 'housekeeper'

/** Профиль пользователя (Supabase Auth + таблица profiles) */
export interface PublicUser {
  id: string
  email: string
  username: string
  role: UserRole
  /** Может добавлять новых пользователей */
  canManageUsers: boolean
  /** Максимальные права на все разделы админки и данные */
  fullAccess: boolean
}

export interface Guest {
  id: string
  firstName: string
  lastName: string
  /** Отчество */
  middleName?: string | null
  /** Справочник citizenships */
  citizenshipId?: number | null
  phone?: string | null
  email?: string | null
  roomId: string
  /** Дата заезда, формат yyyy-MM-dd */
  startDate: string
  /** Дата выезда, формат yyyy-MM-dd */
  endDate: string
  /** Дата и время создания карточки (ISO 8601) */
  createdAt: string
  /** Форма оплаты */
  paymentMethod: GuestPaymentMethod
  /** Подтверждение заезда (как в БД: столбец approve) */
  aprove?: boolean
  /** Время нажатия «Подтвердить заезд» (ISO 8601) */
  checkedInAt?: string | null
  /** Подтверждённый выезд (ISO 8601); карточка гостя не удаляется */
  checkedOutAt?: string | null
}
