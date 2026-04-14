/** Заметка-стикер на главной / привязка к гостю в шахматке */
export interface StickyNote {
  id: string
  body: string
  roomId?: string | null
  guestId?: string | null
  /** Конкретный проживающий из списка субгостей брони; при null — привязка только к карточке гостя. */
  bookingSubGuestId?: string | null
  deadlineAt?: string | null
  createdByUserId?: string | null
  createdByName?: string | null
  isCompleted?: boolean
  completedAt?: string | null
  completedByUserId?: string | null
  completedByName?: string | null
  /** С главной: мягкое удаление; строка хранится до автоочистки */
  deletedAt?: string | null
  deletedByUserId?: string | null
  deletedByName?: string | null
  createdAt: string
  updatedAt: string
}

/** Отметка уборки на странице «Уборка в номерах» */
export type RoomCleaningStatus = 'clean' | 'dirty'
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

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

export interface RoomCategory {
  name: string
  weekdayPrice: number
  weekendPrice: number
}

export interface RoomDailyPrice {
  roomId: string
  dayOfWeek: DayOfWeek
  price: number
}

export interface RoomSpecialPriceCondition {
  id: string
  roomId: string
  title: string
  startAt: string
  endAt: string
  prices: Record<DayOfWeek, number>
}

export interface RoomClosure {
  id: string
  roomId: string
  startAt: string
  endAt: string
  reason: string
  createdByUserId?: string | null
  createdByName?: string | null
  repairCompletedAt?: string | null
  resolvedIssues?: string | null
  repairedByUserId?: string | null
  repairedByName?: string | null
  checkedAt?: string | null
  checkedByUserId?: string | null
  checkedByName?: string | null
  checkedByRole?: string | null
  checkedComment?: string | null
  /** Назначенный на ремонт (профиль с ролью technician) */
  assignedTechnicianUserId?: string | null
  assignedTechnicianName?: string | null
}

export interface AdditionalService {
  id: string
  name: string
  price: number
}

export interface BookingAdditionalService {
  bookingId: string
  serviceId: string
  serviceName: string
  quantity: number
  unitPrice: number
}

export interface Booking {
  id: string
  roomId: string
  guestName: string
  startDate: string
  endDate: string
  /** Оплачена ли бронь (дублирует логику гостя при связке guest_id) */
  paymentStatus: PaymentStatus
  /** Зафиксированная стоимость проживания на момент создания брони */
  totalPrice?: number | null
  /** Время заезда в день startDate (HH:mm, локально); без поля — с полуночи */
  checkInTime?: string | null
  /** Время выезда в день endDate (HH:mm); без поля — до конца дня выезда */
  checkOutTime?: string | null
  note?: string
  /** Связь с записью в таблице Guest (имя, подтверждение заезда) */
  guestId?: string
  /** Источник брони (booking_sources.id) */
  bookingSourceId?: number | null
  /** Общее число проживающих (включая основного гостя) */
  guestsCount?: number | null
  /** Число детей среди проживающих */
  childrenCount?: number | null
}

export interface BookingSubGuest {
  id: string
  bookingId: string
  /** Порядковый номер в карточке брони, начиная с 1 (основной гость — №1) */
  position: number
  lastName: string
  firstName: string
  middleName?: string | null
  passportData?: string | null
  isChild: boolean
  age?: number | null
  birthCertificate?: string | null
}

export interface GuestProfile {
  id: string
  firstName: string
  lastName: string
  middleName?: string | null
  citizenshipId?: number | null
  phone?: string | null
  email?: string | null
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

/** Статус оплаты брони и карточки гостя: не оплачен / оплачен */
export type PaymentStatus = 'unpaid' | 'paid'

/** Роль в профиле: админ, консьерж (брони/гости), уборщица (номера). Устаревшее staff в БД приводится к concierge. */
export type UserRole = 'admin' | 'concierge' | 'housekeeper' | 'technician' | 'senior_technician'

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
  /** Устойчивый ID профиля гостя (человек), визиты хранятся отдельно. */
  profileId?: string | null
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
  /** Статус оплаты (согласован с бронью при наличии guest_id) */
  paymentStatus: PaymentStatus
  /** Форма оплаты: при оплате — наличные или безнал; при неоплате — unpaid */
  paymentMethod: GuestPaymentMethod
  /** Подтверждение заезда (как в БД: столбец approve) */
  aprove?: boolean
  /** Время нажатия «Подтвердить заезд» (ISO 8601) */
  checkedInAt?: string | null
  /** Подтверждённый выезд (ISO 8601); карточка гостя не удаляется */
  checkedOutAt?: string | null
}
