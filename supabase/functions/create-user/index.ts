import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

type AppRole = 'admin' | 'concierge' | 'housekeeper'

type Body = {
  email: string
  username?: string
  role?: string
  can_manage_users?: boolean
  full_access?: boolean
}

function normalizeAppRole(raw: string | undefined): AppRole {
  if (raw === 'admin') return 'admin'
  if (raw === 'housekeeper') return 'housekeeper'
  return 'concierge'
}

function isProfileAdmin(row: {
  role: string | null
  full_access: boolean | null
}): boolean {
  if (row.full_access === true) return true
  const r = (row.role ?? '').toLowerCase()
  return r === 'admin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const { data: profile, error: profErr } = await userClient
      .from('profiles')
      .select('role, full_access')
      .eq('id', user.id)
      .maybeSingle()

    if (profErr || !profile || !isProfileAdmin(profile)) {
      return json({ error: 'Только администратор может создавать пользователей.' }, 403)
    }

    const body = (await req.json()) as Body
    const email = body.email?.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      return json({ error: 'Укажите корректный email для приглашения.' }, 400)
    }

    const appUrl = (Deno.env.get('APP_PUBLIC_URL') ?? Deno.env.get('SITE_URL') ?? '').trim()
    if (!appUrl) {
      return json(
        {
          error:
            'Задайте секрет APP_PUBLIC_URL (URL фронта) для ссылки в письме приглашения.',
        },
        500,
      )
    }

    const redirectTo = `${appUrl.replace(/\/$/, '')}/login`
    const role = normalizeAppRole(body.role)
    const username = (body.username?.trim() || email.split('@')[0] || 'user').slice(0, 200)

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { username },
    })

    if (invErr || !invited.user) {
      const msg = invErr?.message ?? 'Не удалось отправить приглашение'
      const lower = msg.toLowerCase()
      if (lower.includes('already') || lower.includes('registered') || lower.includes('exists')) {
        return json({ error: 'Пользователь с таким email уже зарегистрирован.' }, 400)
      }
      return json({ error: msg }, 400)
    }

    const uid = invited.user.id

    const { error: updErr } = await admin
      .from('profiles')
      .update({
        email,
        username,
        role,
        can_manage_users: !!body.can_manage_users,
        full_access: !!body.full_access,
      })
      .eq('id', uid)

    if (updErr) {
      return json({ error: updErr.message }, 500)
    }

    return json({ ok: true, id: uid })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
