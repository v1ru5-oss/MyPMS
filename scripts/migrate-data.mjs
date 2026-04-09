#!/usr/bin/env node
/**
 * Одноразовый импорт номеров, гостей, броней и пользователей в Supabase.
 *
 * 1) Экспорт из старого браузера (консоль DevTools на сайте с localStorage):
 *    copy(JSON.stringify({
 *      rooms: JSON.parse(localStorage.getItem('pms.rooms') || '[]'),
 *      guests: JSON.parse(localStorage.getItem('pms.guests') || '[]'),
 *      bookings: JSON.parse(localStorage.getItem('pms.bookings') || '[]'),
 *      users: JSON.parse(localStorage.getItem('pms.users') || '[]'),
 *    }))
 *    Сохраните вывод в файл, например migration-export.json
 *
 * 2) В корень проекта (не в git): добавьте в .env.local строки:
 *    SUPABASE_SERVICE_ROLE_KEY=...   (Settings → API → service_role)
 *    MIGRATE_EMAIL_DOMAIN=example.com   (как VITE_AUTH_EMAIL_DOMAIN — для логинов без @)
 *    MIGRATE_USER_PASSWORD=ВременныйСложныйПароль123   (один пароль для всех импорт. пользователей;
 *      хеши из localStorage перенести нельзя — после входа смените пароли в Supabase Dashboard)
 *
 * 3) Примените SQL из supabase/migrations в Supabase SQL Editor (если ещё не применяли).
 *
 * 4) Запуск из каталога MyPMS:
 *    npm run migrate:data -- ./migration-export.json
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function loadDotEnvLocal() {
  const p = path.join(root, '.env.local')
  if (!fs.existsSync(p)) return
  const text = fs.readFileSync(p, 'utf8')
  for (const line of text.split(/\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadDotEnvLocal()

const url =
  process.env.VITE_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim() ||
  ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
const emailDomain = (process.env.MIGRATE_EMAIL_DOMAIN || process.env.VITE_AUTH_EMAIL_DOMAIN || 'example.com').trim()
const migratePassword = process.env.MIGRATE_USER_PASSWORD?.trim() || ''

function loginToEmail(login) {
  const t = String(login).trim().toLowerCase()
  if (t.includes('@')) return t
  const local = t.replace(/\s+/g, '') || 'user'
  return `${local}@${emailDomain}`
}

function roomRow(r) {
  return {
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    category: (r.category ?? '').trim() || null,
  }
}

function guestRow(g) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: g.id,
    first_name: g.firstName ?? g.first_name,
    last_name: g.lastName ?? g.last_name,
    room_id: g.roomId ?? g.room_id,
    start_date: (g.startDate ?? g.start_date ?? today).slice(0, 10),
    end_date: (g.endDate ?? g.end_date ?? today).slice(0, 10),
    created_at: g.createdAt ?? g.created_at ?? `${(g.startDate ?? today).slice(0, 10)}T00:00:00.000Z`,
    payment_method: g.paymentMethod ?? g.payment_method ?? 'unpaid',
    approve: g.aprove ?? g.approve ?? false,
  }
}

function bookingRow(b) {
  return {
    id: b.id,
    room_id: b.roomId ?? b.room_id,
    guest_name: b.guestName ?? b.guest_name,
    start_date: (b.startDate ?? b.start_date).slice(0, 10),
    end_date: (b.endDate ?? b.end_date).slice(0, 10),
    note: b.note ?? null,
    guest_id: b.guestId ?? b.guest_id ?? null,
  }
}

async function findUserByEmail(admin, email) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users ?? []
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (users.length < 200) return null
    page += 1
  }
}

async function main() {
  const exportPath = path.resolve(process.argv[2] || path.join(root, 'migration-export.json'))
  if (!url || !serviceKey) {
    console.error('Нужны VITE_SUPABASE_URL (или SUPABASE_URL) и SUPABASE_SERVICE_ROLE_KEY в .env.local')
    process.exit(1)
  }
  if (!fs.existsSync(exportPath)) {
    console.error('Файл не найден:', exportPath)
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(exportPath, 'utf8'))
  const rooms = Array.isArray(raw.rooms) ? raw.rooms : []
  const guests = Array.isArray(raw.guests) ? raw.guests : []
  const bookings = Array.isArray(raw.bookings) ? raw.bookings : []
  const users = Array.isArray(raw.users) ? raw.users : []

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  if (rooms.length) {
    const rows = rooms.map(roomRow)
    const { error } = await admin.from('rooms').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`rooms: ${error.message}`)
    console.log('rooms:', rows.length)
  }

  if (guests.length) {
    const rows = guests.map(guestRow)
    const { error } = await admin.from('guests').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`guests: ${error.message}`)
    console.log('guests:', rows.length)
  }

  if (bookings.length) {
    const rows = bookings.map(bookingRow)
    const { error } = await admin.from('bookings').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`bookings: ${error.message}`)
    console.log('bookings:', rows.length)
  }

  if (users.length) {
    if (!migratePassword || migratePassword.length < 6) {
      console.error(
        'Для импорта users задайте MIGRATE_USER_PASSWORD в .env.local (Supabase: обычно не короче 6 символов).',
      )
      process.exit(1)
    }
    for (const u of users) {
      const username = (u.username || 'user').trim()
      const email = loginToEmail(username)
      const role = u.role === 'admin' ? 'admin' : 'staff'
      const canManageUsers = !!u.canManageUsers
      const fullAccess = !!u.fullAccess

      let uid = null
      const existing = await findUserByEmail(admin, email)
      if (existing) {
        uid = existing.id
        console.log('user уже есть, обновляю profile:', email)
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password: migratePassword,
          email_confirm: true,
          user_metadata: { username },
        })
        if (cErr) {
          console.error('createUser', email, cErr.message)
          continue
        }
        uid = created.user?.id ?? null
        if (!uid) continue
        console.log('user создан:', email)
      }

      const { error: pErr } = await admin.from('profiles').upsert(
        {
          id: uid,
          email,
          username,
          role,
          can_manage_users: canManageUsers,
          full_access: fullAccess,
        },
        { onConflict: 'id' },
      )
      if (pErr) console.error('profiles', email, pErr.message)
    }
  }

  console.log('Готово.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
