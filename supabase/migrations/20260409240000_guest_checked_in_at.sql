-- Момент подтверждения заезда (кнопка «Подтвердить заезд»).

alter table public.guests
  add column if not exists checked_in_at timestamptz;
