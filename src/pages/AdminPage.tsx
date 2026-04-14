import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminUser } from '@/lib/access'
import {
  deleteAdditionalService,
  fetchAdditionalServices,
  fetchBookings,
  fetchProfiles,
  fetchRoomCategories,
  fetchRoomClosures,
  fetchRoomDailyPrices,
  fetchRoomSpecialPriceConditions,
  fetchRooms,
  deleteRoomCategory,
  setRoomDailyPrices,
  setRoomClosures as setRoomClosuresInDb,
  setRoomSpecialPriceConditions,
  syncRooms,
  upsertRoomCategory,
  upsertAdditionalService,
} from '@/lib/pms-db'
import { cn, randomUUID } from '@/lib/utils'
import {
  type DayOfWeek,
  type AdditionalService,
  type PublicUser,
  type RoomCategory,
  type RoomClosure,
  type RoomSpecialPriceCondition,
  type Room,
  type UserRole,
} from '@/types/models'

type AdminTab = 'users' | 'rooms' | 'services'
type RoomPricesByRoomId = Record<string, Partial<Record<DayOfWeek, number>>>
type RoomSpecialConditionsByRoomId = Record<string, RoomSpecialPriceCondition[]>
type RoomClosuresByRoomId = Record<string, RoomClosure[]>
type EditableRoomCategory = RoomCategory & { originalName: string }
type EditableSpecialCondition = {
  id: string
  title: string
  startAt: string
  endAt: string
  prices: Record<DayOfWeek, number>
}

type EditableRoomClosure = {
  id: string
  startAt: string
  endAt: string
  reason: string
  createdByUserId?: string | null
  createdByName?: string | null
  repairCompletedAt?: string | null
  resolvedIssues?: string | null
}

const WEEK_DAYS: { dayOfWeek: DayOfWeek; label: string }[] = [
  { dayOfWeek: 1, label: 'Понедельник' },
  { dayOfWeek: 2, label: 'Вторник' },
  { dayOfWeek: 3, label: 'Среда' },
  { dayOfWeek: 4, label: 'Четверг' },
  { dayOfWeek: 5, label: 'Пятница' },
  { dayOfWeek: 6, label: 'Суббота' },
  { dayOfWeek: 0, label: 'Воскресенье' },
]

function getEmptyWeekPrices(): Record<DayOfWeek, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
}

function getWeekPricesFromCategory(category: Pick<RoomCategory, 'weekdayPrice' | 'weekendPrice'>): Record<DayOfWeek, number> {
  return {
    0: category.weekendPrice,
    1: category.weekdayPrice,
    2: category.weekdayPrice,
    3: category.weekdayPrice,
    4: category.weekdayPrice,
    5: category.weekdayPrice,
    6: category.weekendPrice,
  }
}

function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDateTimeInputValue(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

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
  const [roomCategories, setRoomCategories] = useState<EditableRoomCategory[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomCategory, setNewRoomCategory] = useState('Без категории')
  const [newRoomCapacity, setNewRoomCapacity] = useState('2')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryWeekdayPrice, setNewCategoryWeekdayPrice] = useState('0')
  const [newCategoryWeekendPrice, setNewCategoryWeekendPrice] = useState('0')
  const [roomPrices, setRoomPrices] = useState<RoomPricesByRoomId>({})
  const [roomSpecialConditions, setRoomSpecialConditions] = useState<RoomSpecialConditionsByRoomId>({})
  const [roomClosures, setRoomClosures] = useState<RoomClosuresByRoomId>({})
  const [priceDialogRoomId, setPriceDialogRoomId] = useState<string | null>(null)
  const [editedDayPrices, setEditedDayPrices] = useState<Record<DayOfWeek, number>>(getEmptyWeekPrices())
  const [isSavingPrices, setIsSavingPrices] = useState(false)
  const [specialDialogRoomId, setSpecialDialogRoomId] = useState<string | null>(null)
  const [editedSpecialConditions, setEditedSpecialConditions] = useState<EditableSpecialCondition[]>([])
  const [isSavingSpecialConditions, setIsSavingSpecialConditions] = useState(false)
  const [closureDialogRoomId, setClosureDialogRoomId] = useState<string | null>(null)
  const [editedClosures, setEditedClosures] = useState<EditableRoomClosure[]>([])
  const [isSavingClosures, setIsSavingClosures] = useState(false)
  const [roomMsg, setRoomMsg] = useState('')
  const [roomErr, setRoomErr] = useState('')
  const [serviceMsg, setServiceMsg] = useState('')
  const [serviceErr, setServiceErr] = useState('')

  const roomSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRoomsSaveRef = useRef<Room[] | null>(null)
  /** Последовательные syncRooms: параллельные запросы давали гонки delete/upsert и «мигание» списка. */
  const roomPersistChainRef = useRef<Promise<unknown>>(Promise.resolve())

  const [profiles, setProfiles] = useState<PublicUser[]>([])
  const [profilesErr, setProfilesErr] = useState('')
  const [services, setServices] = useState<AdditionalService[]>([])
  const [newServiceName, setNewServiceName] = useState('')
  const [newServicePrice, setNewServicePrice] = useState('0')

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
    void Promise.all([
      fetchRooms(),
      fetchRoomDailyPrices(),
      fetchRoomSpecialPriceConditions(),
      fetchRoomCategories(),
      fetchRoomClosures(),
    ]).then(([nextRooms, dailyPrices, specialConditions, categories, closures]) => {
        const byRoomId: RoomPricesByRoomId = {}
        dailyPrices.forEach((item) => {
          byRoomId[item.roomId] ??= {}
          byRoomId[item.roomId][item.dayOfWeek] = item.price
        })
        const specialByRoomId: RoomSpecialConditionsByRoomId = {}
        specialConditions.forEach((item) => {
          specialByRoomId[item.roomId] ??= []
          specialByRoomId[item.roomId]!.push(item)
        })
        const closuresByRoomId: RoomClosuresByRoomId = {}
        closures.forEach((item) => {
          closuresByRoomId[item.roomId] ??= []
          closuresByRoomId[item.roomId]!.push(item)
        })
        setRooms(nextRooms)
        setRoomPrices(byRoomId)
        setRoomSpecialConditions(specialByRoomId)
        setRoomClosures(closuresByRoomId)
        setRoomCategories(categories.map((category) => ({ ...category, originalName: category.name })))
      })
      .catch(() => {
        /* список номеров остаётся пустым до повторной загрузки */
      })
  }, [])

  useEffect(() => {
    void fetchAdditionalServices()
      .then(setServices)
      .catch(() => {
        /* услуги не блокируют загрузку страницы */
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
    void Promise.all([
      fetchRooms(),
      fetchRoomDailyPrices(),
      fetchRoomSpecialPriceConditions(),
      fetchRoomCategories(),
      fetchRoomClosures(),
    ]).then(([nextRooms, dailyPrices, specialConditions, categories, closures]) => {
        const byRoomId: RoomPricesByRoomId = {}
        dailyPrices.forEach((item) => {
          byRoomId[item.roomId] ??= {}
          byRoomId[item.roomId][item.dayOfWeek] = item.price
        })
        const specialByRoomId: RoomSpecialConditionsByRoomId = {}
        specialConditions.forEach((item) => {
          specialByRoomId[item.roomId] ??= []
          specialByRoomId[item.roomId]!.push(item)
        })
        const closuresByRoomId: RoomClosuresByRoomId = {}
        closures.forEach((item) => {
          closuresByRoomId[item.roomId] ??= []
          closuresByRoomId[item.roomId]!.push(item)
        })
        setRooms(nextRooms)
        setRoomPrices(byRoomId)
        setRoomSpecialConditions(specialByRoomId)
        setRoomClosures(closuresByRoomId)
        setRoomCategories(categories.map((category) => ({ ...category, originalName: category.name })))
      })
      .catch(() => {
        setRoomErr('Не удалось загрузить номера.')
      })
  }, [])

  function formatRoomPricePreview(roomId: string): string {
    const prices = roomPrices[roomId]
    if (!prices) return 'Не задано'
    const values = Object.values(prices).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (values.length === 0) return 'Не задано'
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (min === max) return `${min.toLocaleString('ru-RU')} ₽`
    return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} ₽`
  }

  function openRoomPricesDialog(roomId: string) {
    const current = roomPrices[roomId] ?? {}
    const next = getEmptyWeekPrices()
    WEEK_DAYS.forEach(({ dayOfWeek }) => {
      const price = current[dayOfWeek]
      next[dayOfWeek] = typeof price === 'number' && Number.isFinite(price) ? price : 0
    })
    setEditedDayPrices(next)
    setPriceDialogRoomId(roomId)
  }

  async function handleSaveRoomPrices() {
    if (!priceDialogRoomId) return
    setIsSavingPrices(true)
    setRoomErr('')
    setRoomMsg('')
    try {
      await setRoomDailyPrices(priceDialogRoomId, editedDayPrices)
      setRoomPrices((prev) => ({ ...prev, [priceDialogRoomId]: { ...editedDayPrices } }))
      setRoomMsg('Цены по дням недели сохранены.')
      setPriceDialogRoomId(null)
    } catch {
      setRoomErr('Не удалось сохранить цены номера.')
    } finally {
      setIsSavingPrices(false)
    }
  }

  function formatSpecialConditionsPreview(roomId: string): string {
    const list = roomSpecialConditions[roomId] ?? []
    if (list.length === 0) return 'Не задано'
    return `${list.length} усл.`
  }

  function openSpecialConditionsDialog(roomId: string) {
    const list = roomSpecialConditions[roomId] ?? []
    const mapped: EditableSpecialCondition[] = list.map((item) => ({
      id: item.id,
      title: item.title,
      startAt: toLocalDateTimeInputValue(item.startAt),
      endAt: toLocalDateTimeInputValue(item.endAt),
      prices: { ...item.prices },
    }))
    setEditedSpecialConditions(mapped)
    setSpecialDialogRoomId(roomId)
  }

  function addSpecialCondition() {
    const now = new Date()
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    setEditedSpecialConditions((prev) => [
      ...prev,
      {
        id: randomUUID(),
        title: '',
        startAt: toLocalDateTimeInputValue(now.toISOString()),
        endAt: toLocalDateTimeInputValue(end.toISOString()),
        prices: getEmptyWeekPrices(),
      },
    ])
  }

  function removeSpecialCondition(id: string) {
    setEditedSpecialConditions((prev) => prev.filter((x) => x.id !== id))
  }

  async function handleSaveSpecialConditions() {
    if (!specialDialogRoomId) return
    const normalized = editedSpecialConditions.map((item) => ({
      id: item.id,
      title: item.title.trim(),
      startAt: fromLocalDateTimeInputValue(item.startAt),
      endAt: fromLocalDateTimeInputValue(item.endAt),
      prices: { ...item.prices },
    }))
    if (normalized.some((item) => !item.title)) {
      setRoomErr('Заполните название каждого особого условия.')
      return
    }
    if (normalized.some((item) => new Date(item.endAt).getTime() < new Date(item.startAt).getTime())) {
      setRoomErr('Дата окончания особого условия не может быть раньше даты начала.')
      return
    }
    setIsSavingSpecialConditions(true)
    setRoomErr('')
    setRoomMsg('')
    try {
      await setRoomSpecialPriceConditions(specialDialogRoomId, normalized)
      setRoomSpecialConditions((prev) => ({
        ...prev,
        [specialDialogRoomId]: normalized.map((x) => ({ ...x, roomId: specialDialogRoomId })),
      }))
      setRoomMsg('Особые условия сохранены.')
      setSpecialDialogRoomId(null)
    } catch {
      setRoomErr('Не удалось сохранить особые условия.')
    } finally {
      setIsSavingSpecialConditions(false)
    }
  }

  function formatClosuresPreview(roomId: string): string {
    const list = roomClosures[roomId] ?? []
    if (list.length === 0) return 'Не задано'
    return `${list.length} интервал(ов)`
  }

  function openClosuresDialog(roomId: string) {
    const list = roomClosures[roomId] ?? []
    const mapped: EditableRoomClosure[] = list.map((item) => ({
      id: item.id,
      startAt: toLocalDateTimeInputValue(item.startAt),
      endAt: toLocalDateTimeInputValue(item.endAt),
      reason: item.reason,
      createdByUserId: item.createdByUserId ?? null,
      createdByName: item.createdByName ?? null,
      repairCompletedAt: item.repairCompletedAt ?? null,
      resolvedIssues: item.resolvedIssues ?? null,
    }))
    setEditedClosures(mapped)
    setClosureDialogRoomId(roomId)
  }

  function addClosure() {
    const now = new Date()
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    setEditedClosures((prev) => [
      ...prev,
      {
        id: randomUUID(),
        startAt: toLocalDateTimeInputValue(now.toISOString()),
        endAt: toLocalDateTimeInputValue(end.toISOString()),
        reason: '',
        createdByUserId: user?.id ?? null,
        createdByName: user?.username ?? null,
        repairCompletedAt: null,
        resolvedIssues: null,
      },
    ])
  }

  function removeClosure(id: string) {
    setEditedClosures((prev) => prev.filter((x) => x.id !== id))
  }

  async function handleSaveClosures() {
    if (!closureDialogRoomId) return
    const existingList = roomClosures[closureDialogRoomId] ?? []
    const normalized = editedClosures.map((item) => {
      const existing = existingList.find((e) => e.id === item.id)
      return {
        id: item.id,
        startAt: fromLocalDateTimeInputValue(item.startAt),
        endAt: fromLocalDateTimeInputValue(item.endAt),
        reason: item.reason.trim(),
        createdByUserId: item.createdByUserId ?? user?.id ?? null,
        createdByName: item.createdByName ?? user?.username ?? null,
        repairCompletedAt: item.repairCompletedAt ?? null,
        resolvedIssues: item.resolvedIssues ?? null,
        repairedByUserId: existing?.repairedByUserId ?? null,
        repairedByName: existing?.repairedByName ?? null,
        checkedAt: existing?.checkedAt ?? null,
        checkedByUserId: existing?.checkedByUserId ?? null,
        checkedByName: existing?.checkedByName ?? null,
        checkedByRole: existing?.checkedByRole ?? null,
        checkedComment: existing?.checkedComment ?? null,
        assignedTechnicianUserId: existing?.assignedTechnicianUserId ?? null,
        assignedTechnicianName: existing?.assignedTechnicianName ?? null,
      }
    })
    if (normalized.some((item) => !item.reason)) {
      setRoomErr('Укажите причину для каждого закрытия.')
      return
    }
    if (normalized.some((item) => new Date(item.endAt).getTime() < new Date(item.startAt).getTime())) {
      setRoomErr('Дата окончания закрытия не может быть раньше даты начала.')
      return
    }
    setIsSavingClosures(true)
    setRoomErr('')
    setRoomMsg('')
    try {
      await setRoomClosuresInDb(closureDialogRoomId, normalized)
      setRoomClosures((prev) => ({
        ...prev,
        [closureDialogRoomId]: normalized.map((x) => ({ ...x, roomId: closureDialogRoomId })),
      }))
      setRoomMsg('Периоды закрытия номера сохранены.')
      setClosureDialogRoomId(null)
    } catch {
      setRoomErr('Не удалось сохранить периоды закрытия.')
    } finally {
      setIsSavingClosures(false)
    }
  }

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

  async function handleRoomCategoryChange(id: string, category: string) {
    handleRoomFieldChange(id, 'category', category)
    const matchedCategory = roomCategories.find((item) => item.name === category)
    if (!matchedCategory) return
    const basePrices = getWeekPricesFromCategory(matchedCategory)
    try {
      await setRoomDailyPrices(id, basePrices)
      setRoomPrices((prev) => ({ ...prev, [id]: basePrices }))
      setRoomMsg(`Для категории «${category}» применена базовая стоимость.`)
    } catch {
      setRoomErr('Не удалось автоматически применить стоимость категории.')
    }
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
    const categoryPricePreset = roomCategories.find((item) => item.name === category)
    const next: Room[] = [
      ...rooms,
      { id: randomUUID(), name, capacity: cap, category },
    ]
    const createdRoom = next[next.length - 1]!
    setRooms(next)
    void queuePersistRooms(next).then((ok) => {
      if (!ok) return
      if (categoryPricePreset) {
        const basePrices = getWeekPricesFromCategory(categoryPricePreset)
        void setRoomDailyPrices(createdRoom.id, basePrices)
          .then(() => {
            setRoomPrices((prev) => ({ ...prev, [createdRoom.id]: basePrices }))
          })
          .catch(() => {
            setRoomErr('Номер добавлен, но не удалось применить базовую стоимость категории.')
          })
      }
      setNewRoomName('')
      setNewRoomCategory('Без категории')
      setNewRoomCapacity('2')
      setRoomMsg('Номер добавлен.')
    })
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCategoryName.trim()
    const weekdayPrice = Number(newCategoryWeekdayPrice)
    const weekendPrice = Number(newCategoryWeekendPrice)
    if (!name) {
      setRoomErr('Укажите название категории.')
      return
    }
    if (!Number.isFinite(weekdayPrice) || weekdayPrice < 0 || !Number.isFinite(weekendPrice) || weekendPrice < 0) {
      setRoomErr('Базовые цены категории должны быть не меньше 0.')
      return
    }
    try {
      await upsertRoomCategory({ name, weekdayPrice, weekendPrice })
      const categories = await fetchRoomCategories()
      setRoomCategories(categories.map((category) => ({ ...category, originalName: category.name })))
      setNewCategoryName('')
      setNewCategoryWeekdayPrice('0')
      setNewCategoryWeekendPrice('0')
      setRoomMsg('Категория сохранена.')
    } catch {
      setRoomErr('Не удалось сохранить категорию.')
    }
  }

  function handleCategoryFieldChange(
    originalName: string,
    field: 'name' | 'weekdayPrice' | 'weekendPrice',
    value: string,
  ) {
    setRoomCategories((prev) =>
      prev.map((category) => {
        if (category.originalName !== originalName) return category
        if (field === 'name') return { ...category, name: value }
        const parsed = Number(value)
        return {
          ...category,
          [field]: Number.isFinite(parsed) && parsed >= 0 ? parsed : category[field],
        }
      }),
    )
  }

  async function handleSaveCategory(originalName: string) {
    const category = roomCategories.find((item) => item.originalName === originalName)
    if (!category) return
    const trimmedName = category.name.trim()
    if (!trimmedName) {
      setRoomErr('Название категории не может быть пустым.')
      return
    }
    if (
      trimmedName !== originalName &&
      roomCategories.some(
        (item) =>
          item.originalName !== originalName &&
          item.name.trim().toLocaleLowerCase('ru') === trimmedName.toLocaleLowerCase('ru'),
      )
    ) {
      setRoomErr('Категория с таким названием уже существует.')
      return
    }
    try {
      await upsertRoomCategory({
        name: trimmedName,
        weekdayPrice: category.weekdayPrice,
        weekendPrice: category.weekendPrice,
      })
      if (trimmedName !== originalName) {
        const renamedRooms = rooms.map((room) =>
          (room.category ?? 'Без категории') === originalName
            ? { ...room, category: trimmedName }
            : room,
        )
        if (renamedRooms !== rooms) {
          setRooms(renamedRooms)
          await queuePersistRooms(renamedRooms)
        }
        await deleteRoomCategory(originalName)
        if (newRoomCategory === originalName) setNewRoomCategory(trimmedName)
      }
      const categories = await fetchRoomCategories()
      setRoomCategories(categories.map((item) => ({ ...item, originalName: item.name })))
      setRoomMsg('Категория обновлена.')
    } catch {
      setRoomErr('Не удалось обновить категорию.')
    }
  }

  async function handleDeleteCategory(name: string) {
    const inUse = rooms.some((room) => (room.category ?? 'Без категории') === name)
    if (inUse) {
      setRoomErr('Нельзя удалить категорию, которая назначена хотя бы одному номеру.')
      return
    }
    if (!window.confirm('Удалить эту категорию номера?')) return
    try {
      await deleteRoomCategory(name)
      setRoomCategories((prev) => prev.filter((item) => item.name !== name))
      setRoomMsg('Категория удалена.')
    } catch {
      setRoomErr('Не удалось удалить категорию.')
    }
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
      if (ok) {
        setRoomPrices((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setRoomSpecialConditions((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setRoomClosures((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setRoomMsg('Номер удалён.')
      }
    })()
  }

  function handleServiceFieldChange(id: string, field: 'name' | 'price', value: string) {
    setServiceErr('')
    setServiceMsg('')
    setServices((prev) =>
      prev.map((service) => {
        if (service.id !== id) return service
        if (field === 'name') return { ...service, name: value }
        const parsed = Number(value)
        return { ...service, price: Number.isFinite(parsed) && parsed >= 0 ? parsed : service.price }
      }),
    )
  }

  async function handleSaveService(id: string) {
    const service = services.find((x) => x.id === id)
    if (!service) return
    if (!service.name.trim()) {
      setServiceErr('Укажите название услуги.')
      return
    }
    try {
      await upsertAdditionalService({ ...service, name: service.name.trim() })
      setServiceMsg('Услуга сохранена.')
    } catch {
      setServiceErr('Не удалось сохранить услугу.')
    }
  }

  async function handleDeleteService(id: string) {
    if (!window.confirm('Удалить эту услугу?')) return
    try {
      await deleteAdditionalService(id)
      setServices((prev) => prev.filter((x) => x.id !== id))
      setServiceMsg('Услуга удалена.')
    } catch {
      setServiceErr('Не удалось удалить услугу.')
    }
  }

  async function handleAddService(e: React.FormEvent) {
    e.preventDefault()
    setServiceErr('')
    setServiceMsg('')
    const name = newServiceName.trim()
    const price = Number(newServicePrice)
    if (!name) {
      setServiceErr('Укажите название услуги.')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      setServiceErr('Цена услуги должна быть не меньше 0.')
      return
    }
    const service: AdditionalService = { id: randomUUID(), name, price }
    try {
      await upsertAdditionalService(service)
      setServices((prev) => [...prev, service].sort((a, b) => a.name.localeCompare(b.name, 'ru')))
      setNewServiceName('')
      setNewServicePrice('0')
      setServiceMsg('Услуга добавлена.')
    } catch {
      setServiceErr('Не удалось добавить услугу.')
    }
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
      <Dialog
        open={priceDialogRoomId !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingPrices) setPriceDialogRoomId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Тариф по дням недели
            </DialogTitle>
            <DialogDescription>
              Задайте стоимость суток для каждого дня недели.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-3">
            {WEEK_DAYS.map((day) => (
              <div key={day.dayOfWeek} className="grid grid-cols-[1fr_150px] items-center gap-3">
                <Label htmlFor={`day-price-${day.dayOfWeek}`}>{day.label}</Label>
                <Input
                  id={`day-price-${day.dayOfWeek}`}
                  type="number"
                  min={0}
                  step={100}
                  value={editedDayPrices[day.dayOfWeek]}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    setEditedDayPrices((prev) => ({
                      ...prev,
                      [day.dayOfWeek]: Number.isFinite(next) && next >= 0 ? next : 0,
                    }))
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPriceDialogRoomId(null)}
              disabled={isSavingPrices}
            >
              Отмена
            </Button>
            <Button type="button" onClick={() => void handleSaveRoomPrices()} disabled={isSavingPrices}>
              {isSavingPrices ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={specialDialogRoomId !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingSpecialConditions) setSpecialDialogRoomId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Особые условия</DialogTitle>
            <DialogDescription>
              При попадании даты проживания в диапазон используется приоритетная стоимость по дням недели.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="outline" onClick={addSpecialCondition}>
              Добавить условие
            </Button>
          </div>
          <div className="mt-4 grid gap-4">
            {editedSpecialConditions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Особые условия ещё не добавлены.</p>
            ) : (
              editedSpecialConditions.map((condition) => (
                <div key={condition.id} className="rounded-md border p-3">
                  <div className="mb-3 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2 sm:col-span-2">
                      <Label htmlFor={`cond-title-${condition.id}`}>Название условия</Label>
                      <Input
                        id={`cond-title-${condition.id}`}
                        value={condition.title}
                        onChange={(e) =>
                          setEditedSpecialConditions((prev) =>
                            prev.map((x) =>
                              x.id === condition.id ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="Например, Новогодние праздники"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`cond-start-${condition.id}`}>Начало</Label>
                      <Input
                        id={`cond-start-${condition.id}`}
                        type="datetime-local"
                        value={condition.startAt}
                        onChange={(e) =>
                          setEditedSpecialConditions((prev) =>
                            prev.map((x) =>
                              x.id === condition.id ? { ...x, startAt: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`cond-end-${condition.id}`}>Окончание</Label>
                      <Input
                        id={`cond-end-${condition.id}`}
                        type="datetime-local"
                        value={condition.endAt}
                        onChange={(e) =>
                          setEditedSpecialConditions((prev) =>
                            prev.map((x) =>
                              x.id === condition.id ? { ...x, endAt: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {WEEK_DAYS.map((day) => (
                      <div key={`${condition.id}-${day.dayOfWeek}`} className="grid grid-cols-[1fr_150px] items-center gap-3">
                        <Label htmlFor={`cond-day-price-${condition.id}-${day.dayOfWeek}`}>{day.label}</Label>
                        <Input
                          id={`cond-day-price-${condition.id}-${day.dayOfWeek}`}
                          type="number"
                          min={0}
                          step={100}
                          value={condition.prices[day.dayOfWeek]}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            setEditedSpecialConditions((prev) =>
                              prev.map((x) =>
                                x.id === condition.id
                                  ? {
                                      ...x,
                                      prices: {
                                        ...x.prices,
                                        [day.dayOfWeek]:
                                          Number.isFinite(next) && next >= 0 ? next : 0,
                                      },
                                    }
                                  : x,
                              ),
                            )
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button type="button" variant="outline" onClick={() => removeSpecialCondition(condition.id)}>
                      Удалить условие
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSpecialDialogRoomId(null)}
              disabled={isSavingSpecialConditions}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveSpecialConditions()}
              disabled={isSavingSpecialConditions}
            >
              {isSavingSpecialConditions ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={closureDialogRoomId !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingClosures) setClosureDialogRoomId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Закрытие номера</DialogTitle>
            <DialogDescription>
              Укажите диапазон дат/времени и причину закрытия номера (ремонт, обслуживание и т.д.).
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="outline" onClick={addClosure}>
              Добавить интервал
            </Button>
          </div>
          <div className="mt-4 grid gap-4">
            {editedClosures.length === 0 ? (
              <p className="text-sm text-muted-foreground">Периоды закрытия ещё не добавлены.</p>
            ) : (
              editedClosures.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`closure-start-${item.id}`}>Начало</Label>
                      <Input
                        id={`closure-start-${item.id}`}
                        type="datetime-local"
                        value={item.startAt}
                        onChange={(e) =>
                          setEditedClosures((prev) =>
                            prev.map((x) => (x.id === item.id ? { ...x, startAt: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`closure-end-${item.id}`}>Окончание</Label>
                      <Input
                        id={`closure-end-${item.id}`}
                        type="datetime-local"
                        value={item.endAt}
                        onChange={(e) =>
                          setEditedClosures((prev) =>
                            prev.map((x) => (x.id === item.id ? { ...x, endAt: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <Label htmlFor={`closure-reason-${item.id}`}>Причина</Label>
                    <Input
                      id={`closure-reason-${item.id}`}
                      value={item.reason}
                      onChange={(e) =>
                        setEditedClosures((prev) =>
                          prev.map((x) => (x.id === item.id ? { ...x, reason: e.target.value } : x)),
                        )
                      }
                      placeholder="Например, ремонт санузла"
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button type="button" variant="outline" onClick={() => removeClosure(item.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setClosureDialogRoomId(null)}
              disabled={isSavingClosures}
            >
              Отмена
            </Button>
            <Button type="button" onClick={() => void handleSaveClosures()} disabled={isSavingClosures}>
              {isSavingClosures ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex w-full max-w-none flex-col gap-8">
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
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'services'}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                activeTab === 'services'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:text-foreground',
              )}
              onClick={() => setActiveTab('services')}
            >
              Дополнительные услуги
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
                      <option value="technician">Техник</option>
                      <option value="senior_technician">Старший техник</option>
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
          ) : activeTab === 'rooms' ? (
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

              <details className="mt-6 rounded-md border p-4" open>
                <summary className="cursor-pointer select-none text-base font-medium">Категории номеров</summary>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Название</th>
                        <th className="pb-2 pr-3 font-medium">Будни</th>
                        <th className="pb-2 pr-3 font-medium">Выходные</th>
                        <th className="pb-2 font-medium">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomCategories.map((category) => (
                        <tr key={category.originalName} className="border-b border-border">
                          <td className="py-2 pr-3 align-middle">
                            <Input
                              value={category.name}
                              onChange={(e) =>
                                handleCategoryFieldChange(category.originalName, 'name', e.target.value)
                              }
                              aria-label={`Название категории ${category.name}`}
                            />
                          </td>
                          <td className="max-w-[140px] py-2 pr-3 align-middle">
                            <Input
                              type="number"
                              min={0}
                              step={100}
                              value={category.weekdayPrice}
                              onChange={(e) =>
                                handleCategoryFieldChange(category.originalName, 'weekdayPrice', e.target.value)
                              }
                              aria-label={`Базовая цена в будни для категории ${category.name}`}
                            />
                          </td>
                          <td className="max-w-[140px] py-2 pr-3 align-middle">
                            <Input
                              type="number"
                              min={0}
                              step={100}
                              value={category.weekendPrice}
                              onChange={(e) =>
                                handleCategoryFieldChange(category.originalName, 'weekendPrice', e.target.value)
                              }
                              aria-label={`Базовая цена в выходные для категории ${category.name}`}
                            />
                          </td>
                          <td className="py-2 align-middle">
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => void handleSaveCategory(category.originalName)}>
                                Сохранить
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => void handleDeleteCategory(category.name)}
                              >
                                Удалить
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <form
                    className="mt-4 grid max-w-xl gap-4 border-t pt-4 sm:grid-cols-[1fr_140px_140px_auto]"
                    onSubmit={handleAddCategory}
                  >
                    <Input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Новая категория"
                      aria-label="Название новой категории"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={100}
                      value={newCategoryWeekdayPrice}
                      onChange={(e) => setNewCategoryWeekdayPrice(e.target.value)}
                      aria-label="Базовая цена в будни для новой категории"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={100}
                      value={newCategoryWeekendPrice}
                      onChange={(e) => setNewCategoryWeekendPrice(e.target.value)}
                      aria-label="Базовая цена в выходные для новой категории"
                    />
                    <Button type="submit" className="w-fit">
                      Добавить категорию
                    </Button>
                  </form>
                </div>
              </details>

              <details className="mt-6 rounded-md border p-4" open>
                <summary className="cursor-pointer select-none text-base font-medium">Номера</summary>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Название</th>
                        <th className="pb-2 pr-3 font-medium">Категория</th>
                        <th className="pb-2 pr-3 font-medium">Вместимость</th>
                        <th className="pb-2 pr-3 font-medium">Цены</th>
                        <th className="pb-2 pr-3 font-medium">Особые условия</th>
                        <th className="pb-2 pr-3 font-medium">Закрытия</th>
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
                            <select
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={r.category ?? 'Без категории'}
                              onChange={(e) => void handleRoomCategoryChange(r.id, e.target.value)}
                              aria-label={`Категория ${r.name}`}
                            >
                              <option value="Без категории">Без категории</option>
                              {roomCategories.map((category) => (
                                <option key={category.originalName} value={category.name}>
                                  {category.name}
                                </option>
                              ))}
                            </select>
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
                          <td className="py-2 pr-3 align-middle">
                            <Button type="button" variant="outline" size="sm" onClick={() => openRoomPricesDialog(r.id)}>
                              {formatRoomPricePreview(r.id)}
                            </Button>
                          </td>
                          <td className="py-2 pr-3 align-middle">
                            <Button type="button" variant="outline" size="sm" onClick={() => openSpecialConditionsDialog(r.id)}>
                              {formatSpecialConditionsPreview(r.id)}
                            </Button>
                          </td>
                          <td className="py-2 pr-3 align-middle">
                            <Button type="button" variant="outline" size="sm" onClick={() => openClosuresDialog(r.id)}>
                              {formatClosuresPreview(r.id)}
                            </Button>
                          </td>
                          <td className="py-2 align-middle">
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openClosuresDialog(r.id)}>
                                Закрыть
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => handleRemoveRoom(r.id)}
                              >
                                Удалить
                              </Button>
                            </div>
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
                      <select
                        id="nrCat"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={newRoomCategory}
                        onChange={(e) => setNewRoomCategory(e.target.value)}
                      >
                        <option value="Без категории">Без категории</option>
                        {roomCategories.map((category) => (
                          <option key={category.originalName} value={category.name}>
                            {category.name}
                          </option>
                        ))}
                      </select>
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
              </details>
            </section>
            </div>
          ) : (
            <div className="flex flex-col gap-8" role="tabpanel">
              <section className="rounded-lg border p-6">
                <h2 className="text-lg font-medium">Дополнительные услуги</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Справочник услуг: название, стоимость и управление.
                </p>

                {serviceErr ? (
                  <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    {serviceErr}
                  </p>
                ) : null}
                {serviceMsg ? (
                  <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
                    {serviceMsg}
                  </p>
                ) : null}

                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[540px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Название</th>
                        <th className="pb-2 pr-3 font-medium">Цена</th>
                        <th className="pb-2 font-medium">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((service) => (
                        <tr key={service.id} className="border-b border-border">
                          <td className="py-2 pr-3 align-middle">
                            <Input
                              value={service.name}
                              onChange={(e) => handleServiceFieldChange(service.id, 'name', e.target.value)}
                              aria-label={`Название услуги ${service.name}`}
                            />
                          </td>
                          <td className="max-w-[180px] py-2 pr-3 align-middle">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              value={service.price}
                              onChange={(e) => handleServiceFieldChange(service.id, 'price', e.target.value)}
                              aria-label={`Цена услуги ${service.name}`}
                            />
                          </td>
                          <td className="py-2 align-middle">
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => void handleSaveService(service.id)}>
                                Сохранить
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => void handleDeleteService(service.id)}
                              >
                                Удалить
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form className="mt-8 grid max-w-xl gap-4 border-t pt-6" onSubmit={handleAddService}>
                  <h3 className="text-base font-medium">Добавить услугу</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="svcName">Название</Label>
                      <Input
                        id="svcName"
                        value={newServiceName}
                        onChange={(e) => setNewServiceName(e.target.value)}
                        placeholder="Например, Трансфер"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="svcPrice">Цена</Label>
                      <Input
                        id="svcPrice"
                        type="number"
                        min={0}
                        value={newServicePrice}
                        onChange={(e) => setNewServicePrice(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-fit">
                    Добавить услугу
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
