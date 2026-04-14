import { format, isValid, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatCheckInTimeShort, formatCheckOutTimeShort } from '@/lib/booking-check-in-time'
import { formatGuestFullName } from '@/lib/guest-name'
import { guestPaymentLabel, paymentStatusLabel } from '@/lib/guest-payment'
import {
  fetchBookingByGuestId,
  fetchBookingSources,
  fetchCitizenships,
  fetchGuestById,
  fetchRooms,
  patchGuestAndLinkedBookingsPayment,
} from '@/lib/pms-db'
import {
  type Booking,
  type BookingSource,
  type Citizenship,
  type Guest,
  type PaymentStatus,
  type Room,
} from '@/types/models'

export type GuestDetailPanelLayout = 'page' | 'embedded'

type GuestDetailPanelProps = {
  guestId: string | null | undefined
  layout?: GuestDetailPanelLayout
  /** Для layout «page»: переход на главную при ошибках / «не найден» */
  onNavigateHome?: () => void
}

export function GuestDetailPanel({
  guestId,
  layout = 'page',
  onNavigateHome,
}: GuestDetailPanelProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [guest, setGuest] = useState<Guest | undefined>(undefined)
  const [linkedBooking, setLinkedBooking] = useState<Booking | null>(null)
  const [citizenships, setCitizenships] = useState<Citizenship[]>([])
  const [bookingSources, setBookingSources] = useState<BookingSource[]>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentSaveError, setPaymentSaveError] = useState('')
  const [localPaymentStatus, setLocalPaymentStatus] = useState<PaymentStatus>('unpaid')
  const [localPaymentChannel, setLocalPaymentChannel] = useState<'cash' | 'transfer'>('cash')

  useEffect(() => {
    let cancelled = false
    setLoadError('')

    if (!guestId?.trim()) {
      setGuest(undefined)
      setLinkedBooking(null)
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const r = await fetchRooms()
        if (!cancelled) setRooms(r)
        const [g, booking, cit, src] = await Promise.all([
          fetchGuestById(guestId),
          fetchBookingByGuestId(guestId),
          fetchCitizenships().catch(() => [] as Citizenship[]),
          fetchBookingSources().catch(() => [] as BookingSource[]),
        ])
        if (!cancelled) {
          setGuest(g)
          setLinkedBooking(booking)
          setCitizenships(cit)
          setBookingSources(src)
          if (g) {
            setLocalPaymentStatus(g.paymentStatus)
            setLocalPaymentChannel(g.paymentMethod === 'transfer' ? 'transfer' : 'cash')
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [guestId])

  const roomName = guest ? rooms.find((r) => r.id === guest.roomId)?.name ?? guest.roomId : ''

  const planCheckInTime = formatCheckInTimeShort(linkedBooking?.checkInTime)
  const planCheckOutTime = formatCheckOutTimeShort(linkedBooking?.checkOutTime)

  const citizenshipLabel =
    guest?.citizenshipId != null
      ? citizenships.find((c) => c.id === guest.citizenshipId)?.name
      : undefined
  const bookingSourceLabel =
    linkedBooking?.bookingSourceId != null
      ? bookingSources.find((s) => s.id === linkedBooking.bookingSourceId)?.name
      : undefined

  const createdParsed = guest ? parseISO(guest.createdAt) : undefined
  const createdFormatted =
    guest && createdParsed && isValid(createdParsed)
      ? format(createdParsed, "d MMMM yyyy 'в' HH:mm", { locale: ru })
      : guest?.createdAt ?? '—'

  const embedded = layout === 'embedded'
  const homeBtn =
    onNavigateHome != null ? (
      <Button type="button" variant="outline" onClick={onNavigateHome}>
        На главную
      </Button>
    ) : null

  if (!guestId?.trim()) {
    if (embedded) {
      return <p className="text-sm text-muted-foreground">Гость не выбран.</p>
    }
    return (
      <main className="flex min-h-screen w-full flex-col gap-6 p-6">
        <p className="text-muted-foreground">Гость не найден.</p>
        {homeBtn}
      </main>
    )
  }

  if (loadError) {
    if (embedded) {
      return <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
    }
    return (
      <main className="flex min-h-screen w-full flex-col gap-6 p-6">
        <p className="text-red-700 dark:text-red-400">{loadError}</p>
        {homeBtn}
      </main>
    )
  }

  if (loading) {
    if (embedded) {
      return <p className="text-sm text-muted-foreground">Загрузка…</p>
    }
    return (
      <main className="flex min-h-screen w-full flex-col gap-6 p-6">
        <p className="text-muted-foreground">Загрузка…</p>
      </main>
    )
  }

  if (!guest) {
    if (embedded) {
      return <p className="text-sm text-muted-foreground">Гость не найден.</p>
    }
    return (
      <main className="flex min-h-screen w-full flex-col gap-6 p-6">
        <p className="text-muted-foreground">Гость не найден.</p>
        {homeBtn}
      </main>
    )
  }

  const header = (
    <header className={embedded ? 'space-y-1' : undefined}>
      {embedded ? (
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {formatGuestFullName(guest)}
        </h2>
      ) : (
        <h1 className="text-3xl font-semibold">{formatGuestFullName(guest)}</h1>
      )}
      <p className={embedded ? 'text-sm text-muted-foreground' : 'mt-1 text-muted-foreground'}>
        Номер: {roomName}
      </p>
    </header>
  )

  const section = (
    <section className="space-y-6 rounded-lg border border-border p-4 sm:p-6">
      {citizenshipLabel ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Гражданство</h3>
          <p className="text-sm">{citizenshipLabel}</p>
        </div>
      ) : null}
      {guest.phone?.trim() || guest.email?.trim() ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Контакты</h3>
          {guest.phone?.trim() ? (
            <p className="text-sm">
              <span className="font-medium">Телефон:</span> {guest.phone.trim()}
            </p>
          ) : null}
          {guest.email?.trim() ? (
            <p className="text-sm">
              <span className="font-medium">Почта:</span> {guest.email.trim()}
            </p>
          ) : null}
        </div>
      ) : null}
      {bookingSourceLabel ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Источник брони</h3>
          <p className="text-sm">{bookingSourceLabel}</p>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Проживание</h3>
        {linkedBooking ? (
          <p className="mb-2 text-sm">
            <span className="font-medium">ID брони:</span>{' '}
            <span className="font-mono text-xs text-muted-foreground">{linkedBooking.id}</span>
          </p>
        ) : null}
        <p className="text-sm">
          <span className="font-medium">Заезд:</span>{' '}
          {format(parseISO(guest.startDate), 'dd.MM.yyyy', { locale: ru })}
          {planCheckInTime ? (
            <>
              , <span className="tabular-nums">{planCheckInTime}</span>
            </>
          ) : null}
          {guest.checkedInAt ? (
            <>
              {' '}
              <span className="text-muted-foreground">
                (подтверждён:{' '}
                {(() => {
                  const d = parseISO(guest.checkedInAt)
                  return isValid(d) ? format(d, 'dd.MM.yyyy, HH:mm', { locale: ru }) : guest.checkedInAt
                })()}
                )
              </span>
            </>
          ) : null}
        </p>
        <p className="mt-1 text-sm">
          <span className="font-medium">Выезд:</span>{' '}
          {format(parseISO(guest.endDate), 'dd.MM.yyyy', { locale: ru })}
          {planCheckOutTime ? (
            <>
              , <span className="tabular-nums">{planCheckOutTime}</span>
            </>
          ) : null}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Карточка создана</h3>
        <p className="text-sm">{createdFormatted}</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Оплата</h3>
        <p className="text-sm">
          <span className="font-medium">{paymentStatusLabel(guest.paymentStatus)}</span>
          {guest.paymentStatus === 'paid' ? (
            <span className="text-muted-foreground"> · {guestPaymentLabel(guest.paymentMethod)}</span>
          ) : null}
        </p>
        {linkedBooking ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Бронь: {paymentStatusLabel(linkedBooking.paymentStatus)}
            {linkedBooking.paymentStatus !== guest.paymentStatus ? (
              <span className="text-amber-700 dark:text-amber-300"> (рассинхрон — сохраните ниже)</span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="grid min-w-[10rem] flex-1 gap-1">
            <Label htmlFor="guestPayStatus">Статус оплаты</Label>
            <select
              id="guestPayStatus"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={localPaymentStatus}
              onChange={(e) => setLocalPaymentStatus(e.target.value as PaymentStatus)}
              disabled={paymentSaving}
            >
              <option value="unpaid">Не оплачен</option>
              <option value="paid">Оплачен</option>
            </select>
          </div>
          {localPaymentStatus === 'paid' ? (
            <div className="grid min-w-[10rem] flex-1 gap-1">
              <Label htmlFor="guestPayChannel">Способ</Label>
              <select
                id="guestPayChannel"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={localPaymentChannel}
                onChange={(e) => setLocalPaymentChannel(e.target.value as 'cash' | 'transfer')}
                disabled={paymentSaving}
              >
                <option value="cash">Наличные</option>
                <option value="transfer">Безналичные</option>
              </select>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={paymentSaving || !guestId?.trim()}
            onClick={() => {
              if (!guestId?.trim()) return
              void (async () => {
                setPaymentSaving(true)
                setPaymentSaveError('')
                try {
                  await patchGuestAndLinkedBookingsPayment(
                    guestId,
                    localPaymentStatus,
                    localPaymentChannel,
                  )
                  const [nextGuest, nextBooking] = await Promise.all([
                    fetchGuestById(guestId),
                    fetchBookingByGuestId(guestId),
                  ])
                  if (nextGuest) {
                    setGuest(nextGuest)
                    setLocalPaymentStatus(nextGuest.paymentStatus)
                    setLocalPaymentChannel(nextGuest.paymentMethod === 'transfer' ? 'transfer' : 'cash')
                  }
                  setLinkedBooking(nextBooking ?? null)
                } catch (e) {
                  setPaymentSaveError(e instanceof Error ? e.message : 'Не удалось сохранить оплату.')
                } finally {
                  setPaymentSaving(false)
                }
              })()
            }}
          >
            {paymentSaving ? 'Сохранение…' : 'Сохранить оплату'}
          </Button>
        </div>
        {paymentSaveError ? <p className="mt-2 text-sm text-red-600">{paymentSaveError}</p> : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Подтверждение заезда (aprove)</h3>
        <p className="text-sm">
          {guest.aprove ? (
            <span className="font-medium text-green-700 dark:text-green-400">Заезд подтверждён</span>
          ) : (
            'Не подтверждён'
          )}
        </p>
      </div>

      {guest.checkedOutAt ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Выезд</h3>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Отмечен:{' '}
            {(() => {
              const d = parseISO(guest.checkedOutAt)
              return isValid(d) ? format(d, "d MMMM yyyy 'в' HH:mm", { locale: ru }) : guest.checkedOutAt
            })()}
          </p>
        </div>
      ) : null}
    </section>
  )

  if (embedded) {
    return (
      <div className="space-y-4">
        {header}
        {section}
      </div>
    )
  }

  return (
    <main className="flex min-h-screen w-full flex-col gap-8 p-6">
      {header}
      {section}
    </main>
  )
}
