import { type GuestPaymentMethod, type PaymentStatus } from '@/types/models'

/** Подпись к статусу оплаты */
export function paymentStatusLabel(status: PaymentStatus): string {
  return status === 'paid' ? 'Оплачен' : 'Не оплачен'
}

/** Подписи к полю Guest.paymentMethod для интерфейса */
export function guestPaymentLabel(method: GuestPaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'Наличные'
    case 'transfer':
      return 'Безналичные'
    case 'unpaid':
      return 'Не оплачен'
    default: {
      const _exhaustive: never = method
      return _exhaustive
    }
  }
}
