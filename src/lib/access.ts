import type { PublicUser, UserRole } from '@/types/models'

/** Нормализация устаревшего значения из БД или JWT. */
export function normalizeRole(role: string): UserRole {
  if (role === 'admin') return 'admin'
  if (role === 'housekeeper') return 'housekeeper'
  if (role === 'concierge' || role === 'staff') return 'concierge'
  return 'concierge'
}

export function isAdminUser(user: PublicUser): boolean {
  if (user.fullAccess) return true
  return normalizeRole(user.role) === 'admin'
}

export function isConciergeUser(user: PublicUser): boolean {
  return normalizeRole(user.role) === 'concierge'
}

export function isHousekeeperUser(user: PublicUser): boolean {
  return normalizeRole(user.role) === 'housekeeper'
}

export function canAccessPath(pathname: string, user: PublicUser): boolean {
  const admin = isAdminUser(user)
  const concierge = isConciergeUser(user)
  const housekeeper = isHousekeeperUser(user)

  if (pathname === '/' || pathname === '') return true
  if (pathname === '/summary') return admin
  if (pathname === '/guests') return admin || concierge
  if (pathname === '/room-cleaning') return admin || housekeeper
  if (pathname === '/admin') return admin
  if (pathname.startsWith('/guest/')) return admin || concierge
  return false
}

/** Куда направить после входа, если запрошенный путь недоступен роли. */
export function defaultHomePathForUser(user: PublicUser): string {
  if (isHousekeeperUser(user) && !isAdminUser(user)) return '/'
  return '/'
}

export function safePathAfterLogin(user: PublicUser, requested: string | undefined): string {
  const path = requested && requested !== '/login' ? requested : '/'
  if (canAccessPath(path, user)) return path
  return defaultHomePathForUser(user)
}
