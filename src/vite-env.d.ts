/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL проекта: Settings → API → Project URL */
  readonly VITE_SUPABASE_URL: string
  /** anon public key: Settings → API → Project API keys */
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Домен для логина без «@» (например hotel.ru → user@hotel.ru) */
  readonly VITE_AUTH_EMAIL_DOMAIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
