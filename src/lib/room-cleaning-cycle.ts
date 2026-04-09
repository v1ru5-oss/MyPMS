import type { RoomCleaningStatus } from '@/types/models'

/** Как на странице «Уборка в номерах»: без отметки → убрано → не убрано → снять. */
export function nextRoomCleaningStatusInCycle(
  current: RoomCleaningStatus | null | undefined,
): RoomCleaningStatus | null {
  if (current === 'dirty') return null
  if (current === 'clean') return 'dirty'
  return 'clean'
}
