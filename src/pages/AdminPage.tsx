import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser } from '@/lib/access'
import { fetchBookings, fetchProfiles, fetchRooms, syncRooms } from '@/lib/pms-db'
import { cn } from '@/lib/utils'
import { type PublicUser, type Room, type UserRole } from '@/types/models'

type AdminTab = 'users' | 'rooms'

export default function AdminPage() {
  const { user, isReady, logout, addUser } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('users')

  const [newUsername, setNewUsername] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('concierge')
  const [newCanManageUsers, setNewCanManageUsers] = useState(false)
  const [newFullAccess, setNewFullAccess] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const [addErr, setAddErr] = useState('')
  const [listTick, setListTick] = useState(0)

  const [rooms, setRooms] = useState<Room[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomCategory, setNewRoomCategory] = useState('')
  const [newRoomCapacity, setNewRoomCapacity] = useState('2')
  const [roomMsg, setRoomMsg] = useState('')
  const [roomErr, setRoomErr] = useState('')

  const roomSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRoomsSaveRef = useRef<Room[] | null>(null)
  /** Последовательные syncRooms: параллельные запросы давали гонки delete/upsert и «мигание» списка. */
  const roomPersistChainRef = useRef<Promise<unknown>>(Promise.resolve())

  const [profiles, setProfiles] = useState<PublicUser[]>([])
  const [profilesErr, setProfilesErr] = useState('')

  useEffect(() => {
    if (!isReady) return
    if (!user) {
      setProfiles([])
      return
    }
    let cancelled = false
    setProfilesErr('')
    void fetchProfiles()
      .then((p) => {
        if (!cancelled) setProfiles(p)
      })
      .catch((e) => {
        if (!cancelled) {
          setProfilesErr(e instanceof Error ? e.message : 'Не удалось загрузить пользователей.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [isReady, user, listTick])

  useEffect(() => {
    void fetchRooms()
      .then(setRooms)
      .catch(() => {
        /* список номеров остаётся пустым до повторной загрузки */
      })
  }, [])

  useEffect(() => {
    return () => {
      if (roomSaveTimerRef.current) clearTimeout(roomSaveTimerRef.current)
    }
  }, [])

  const persistRooms = useCallback(
    async (
      next: Room[],
      opts?: { syncStateFromServer?: boolean },
    ): Promise<boolean> => {
      const normalized = next.map((r) => ({
        ...r,
        category: (r.category ?? '').trim() || 'Без категории',
      }))
      const syncState = opts?.syncStateFromServer !== false
      try {
        await syncRooms(normalized)
        // После ввода в таблице не вызываем setRooms(normalized): запрос мог уйти по старому
        // снимку, а пользователь уже напечатал дальше — иначе input «откатывается» и кажется лаг.
        if (syncState) setRooms(normalized)
        return true
      } catch {
        setRoomErr('Не удалось сохранить номера в Supabase.')
        void fetchRooms()
          .then((data) => {
            setRooms((prev) => {
              // Пустой ответ при сбое/гонке не затирает уже показанный список
              if (data.length === 0 && prev.length > 0) return prev
              return data
            })
          })
          .catch(() => {
            /* оставляем текущий черновик в state */
          })
        return false
      }
    },
    [],
  )

  const queuePersistRooms = useCallback(
    (next: Room[], opts?: { syncStateFromServer?: boolean }) => {
      const chained = roomPersistChainRef.current
        .catch(() => {})
        .then(() => persistRooms(next, opts))
      roomPersistChainRef.current = chained
      return chained
    },
    [persistRooms],
  )

  const scheduleRoomsPersist = useCallback(
    (next: Room[]) => {
      pendingRoomsSaveRef.current = next
      if (roomSaveTimerRef.current) clearTimeout(roomSaveTimerRef.current)
      roomSaveTimerRef.current = setTimeout(() => {
        roomSaveTimerRef.current = null
        const snap = pendingRoomsSaveRef.current
        if (snap) void queuePersistRooms(snap, { syncStateFromServer: false })
      }, 400)
    },
    [queuePersistRooms],
  )

  const cancelPendingRoomsSave = useCallback(() => {
    if (roomSaveTimerRef.current) {
      clearTimeout(roomSaveTimerRef.current)
      roomSaveTimerRef.current = null
    }
    pendingRoomsSaveRef.current = null
  }, [])

  const refreshRooms = useCallback(() => {
    void fetchRooms()
      .then(setRooms)
      .catch(() => {
        setRoomErr('Не удалось загрузить номера.')
      })
  }, [])

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setAddMsg('')
    setAddErr('')
    const res = await addUser({
      username: newUsername,
      role: newRole,
      canManageUsers: newCanManageUsers,
      fullAccess: newFullAccess,
    })
    if (res.ok) {
      setAddMsg(
        'Приглашение отправлено на email (письмо от Supabase Auth). Пользователь задаст пароль по ссылке из письма.',
      )
      setNewUsername('')
      setNewRole('concierge')
      setNewCanManageUsers(false)
      setNewFullAccess(false)
      setListTick((x) => x + 1)
    } else {
      setAddErr(res.error ?? 'Ошибка')
    }
  }

  function handleRoomFieldChange(id: string, field: keyof Pick<Room, 'name' | 'category' | 'capacity'>, value: string) {
    setRoomErr('')
    setRoomMsg('')
    const next = rooms.map((r) => {
      if (r.id !== id) return r
      if (field === 'capacity') {
        const n = parseInt(value, 10)
        return { ...r, capacity: Number.isFinite(n) && n > 0 ? n : r.capacity }
      }
      if (field === 'name') return { ...r, name: value }
      return { ...r, category: value }
    })
    setRooms(next)
    scheduleRoomsPersist(next)
  }

  function handleAddRoom(e: React.FormEvent) {
    e.preventDefault()
    cancelPendingRoomsSave()
    setRoomErr('')
    setRoomMsg('')
    const name = newRoomName.trim()
    const cap = parseInt(newRoomCapacity, 10)
    if (!name) {
      setRoomErr('Укажите название номера.')
      return
    }
    if (!Number.isFinite(cap) || cap < 1) {
      setRoomErr('Вместимость — целое число не меньше 1.')
      return
    }
    const category = newRoomCategory.trim() || 'Без категории'
    const next: Room[] = [
      ...rooms,
      { id: crypto.randomUUID(), name, capacity: cap, category },
    ]
    setRooms(next)
    void queuePersistRooms(next).then((ok) => {
      if (!ok) return
      setNewRoomName('')
      setNewRoomCategory('')
      setNewRoomCapacity('2')
      setRoomMsg('Номер добавлен.')
    })
  }

  function handleRemoveRoom(id: string) {
    cancelPendingRoomsSave()
    setRoomErr('')
    setRoomMsg('')
    void (async () => {
      let list: Awaited<ReturnType<typeof fetchBookings>>
      try {
        list = await fetchBookings()
      } catch {
        setRoomErr('Не удалось проверить брони.')
        return
      }
      const hasBookings = list.some((b) => b.roomId === id)
      if (hasBookings) {
        setRoomErr('Нельзя удалить номер с активными бронями. Сначала перенесите или удалите брони.')
        return
      }
      if (!window.confirm('Удалить этот номер из списка?')) return
      const ok = await queuePersistRooms(rooms.filter((r) => r.id !== id))
      if (ok) setRoomMsg('Номер удалён.')
    })()
  }

  if (!isReady) {
    return (
      <main className="min-h-screen w-full p-4 sm:p-6">
        <div className="mx-auto flex min-h-[50vh] w-full max-w-5xl items-center justify-center">
          <p className="text-muted-foreground">Загрузка…</p>
        </div>
      </main>
    )
  }

  if (!user) return null

  return (
    <main className="min-h-screen w-full p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => void logout()}>
            Выйти ({user.username})
          </Button>
        </div>

        <header>
          <h1 className="text-3xl font-semibold">Админ-панель</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Роль: <span className="font-medium text-foreground">{user.role}</span>
            {user.fullAccess ? ' · полный доступ' : ''}
            {user.canManageUsers ? ' · можно добавлять пользователей' : ''}
          </p>
        </header>

        <div className="flex flex-col gap-6">
          <div
            role="tablist"
            aria-label="Разделы админ-панели"
            className="inline-flex h-10 w-fit items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'users'}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                activeTab === 'users'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:text-foreground',
              )}
              onClick={() => setActiveTab('users')}
            >
              Управление пользователями
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rooms'}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                activeTab === 'rooms'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:text-foreground',
              )}
              onClick={() => {
                setActiveTab('rooms')
                refreshRooms()
              }}
            >
              Управление номерами
            </button>
          </div>

          {activeTab === 'users' ? (
          <div className="flex flex-col gap-8" role="tabpanel">
            <section className="rounded-lg border p-6">
              <h2 className="text-lg font-medium">Пользователи (Supabase Auth + profiles)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Список из таблицы <code className="rounded bg-muted px-1">profiles</code>, привязанной к
                учётным записям в Auth.
              </p>
              {profilesErr ? (
                <p className="mt-3 text-sm text-red-600">{profilesErr}</p>
              ) : null}
              <ul className="mt-4 space-y-2">
                {profiles.map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{u.username}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {u.role}
                      {u.fullAccess ? ' · full' : ''}
                      {u.canManageUsers ? ' · +users' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {isAdminUser(user) ? (
              <section className="rounded-lg border p-6">
                <h2 className="text-lg font-medium">Пригласить пользователя</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Только для администратора. На email уйдёт письмо Supabase Auth со ссылкой: пользователь задаёт пароль
                  сам. В секретах функции <code className="rounded bg-muted px-1">create-user</code> задайте{' '}
                  <code className="rounded bg-muted px-1">APP_PUBLIC_URL</code> (URL фронта); в консоли Supabase в
                  Redirect URLs добавьте <code className="rounded bg-muted px-1">…/login</code>. Включите SMTP или
                  встроенную почту в Authentication → Emails.
                </p>
                <form className="mt-4 grid max-w-md gap-4" onSubmit={handleAddUser}>
                  <div className="grid gap-2">
                    <Label htmlFor="nu">Email (для приглашения)</Label>
                    <Input
                      id="nu"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="user@hotel.ru"
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="nr">Роль</Label>
                    <select
                      id="nr"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as UserRole)}
                    >
                      <option value="concierge">Консьерж</option>
                      <option value="housekeeper">Уборщица</option>
                      <option value="admin">Администратор</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newCanManageUsers}
                      onChange={(e) => setNewCanManageUsers(e.target.checked)}
                    />
                    Может добавлять пользователей
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newFullAccess}
                      onChange={(e) => setNewFullAccess(e.target.checked)}
                    />
                    Полный доступ (все разделы)
                  </label>
                  {addErr ? <p className="text-sm text-red-600">{addErr}</p> : null}
                  {addMsg ? <p className="text-sm text-green-700">{addMsg}</p> : null}
                  <Button type="submit">Отправить приглашение</Button>
                </form>
              </section>
            ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-8" role="tabpanel">
            <section className="rounded-lg border p-6">
              <h2 className="text-lg font-medium">Номера</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Изменения сохраняются в Supabase и отображаются на главной (шахматка, формы брони).
              </p>

              {roomErr ? (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {roomErr}
                </p>
              ) : null}
              {roomMsg ? (
                <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
                  {roomMsg}
                </p>
              ) : null}

              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Название</th>
                      <th className="pb-2 pr-3 font-medium">Категория</th>
                      <th className="pb-2 pr-3 font-medium">Вместимость</th>
                      <th className="pb-2 font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.id} className="border-b border-border">
                        <td className="py-2 pr-3 align-middle">
                          <Input
                            value={r.name}
                            onChange={(e) => handleRoomFieldChange(r.id, 'name', e.target.value)}
                            aria-label={`Название номера ${r.name}`}
                          />
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <Input
                            value={r.category ?? ''}
                            onChange={(e) => handleRoomFieldChange(r.id, 'category', e.target.value)}
                            placeholder="Без категории"
                            aria-label={`Категория ${r.name}`}
                          />
                        </td>
                        <td className="max-w-[120px] py-2 pr-3 align-middle">
                          <Input
                            type="number"
                            min={1}
                            value={r.capacity}
                            onChange={(e) => handleRoomFieldChange(r.id, 'capacity', e.target.value)}
                            aria-label={`Вместимость ${r.name}`}
                          />
                        </td>
                        <td className="py-2 align-middle">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => handleRemoveRoom(r.id)}
                          >
                            Удалить
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form className="mt-8 grid max-w-xl gap-4 border-t pt-6" onSubmit={handleAddRoom}>
                <h3 className="text-base font-medium">Добавить номер</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2 sm:col-span-1">
                    <Label htmlFor="nrName">Название</Label>
                    <Input
                      id="nrName"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="Например, 201"
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-1">
                    <Label htmlFor="nrCat">Категория</Label>
                    <Input
                      id="nrCat"
                      value={newRoomCategory}
                      onChange={(e) => setNewRoomCategory(e.target.value)}
                      placeholder="Дом / корпус"
                    />
                  </div>
                  <div className="grid gap-2 sm:col-span-1">
                    <Label htmlFor="nrCap">Вместимость</Label>
                    <Input
                      id="nrCap"
                      type="number"
                      min={1}
                      value={newRoomCapacity}
                      onChange={(e) => setNewRoomCapacity(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-fit">
                  Добавить номер
                </Button>
              </form>
            </section>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
