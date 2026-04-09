/**
 * Supabase Auth ожидает email. Если пользователь вводит только логин без @,
 * подставляется домен из VITE_AUTH_EMAIL_DOMAIN (по умолчанию example.com).
 */
export function loginToEmail(login: string): string {
  const t = login.trim().toLowerCase()
  if (t.includes('@')) return t
  const domain = import.meta.env.VITE_AUTH_EMAIL_DOMAIN ?? 'example.com'
  const local = t.replace(/\s+/g, '') || 'user'
  return `${local}@${domain}`
}
