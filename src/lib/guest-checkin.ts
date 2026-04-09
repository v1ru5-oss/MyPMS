import type { Booking, Guest } from '@/types/models'

/** Как на шахматке: зелёная полоса только при связи брони с гостем и aprove. */
export function isBookingGuestCheckInApproved(booking: Booking, guests: Guest[]): boolean {
  if (!booking.guestId) return false
  const g = guests.find((x) => x.id === booking.guestId)
  return g?.aprove === true
}

export function guestHasCheckedOut(g: Guest): boolean {
  return Boolean(g.checkedOutAt)
}

/** Есть ли у гостя бронь с guest_id на эту карточку. */
export function guestHasLinkedBooking(guestId: string, bookings: Booking[]): boolean {
  return bookings.some((b) => b.guestId === guestId)
}

/**
 * Заезд подтверждён (как на шахматке для связанной брони — только aprove;
 * без привязанной брони учитываем aprove или checkedInAt с главной).
 */
export function isGuestCheckInConfirmed(guest: Guest, bookings: Booking[]): boolean {
  if (guestHasCheckedOut(guest)) return false
  if (guestHasLinkedBooking(guest.id, bookings)) {
    return guest.aprove === true
  }
  return guest.aprove === true || Boolean(guest.checkedInAt)
}
