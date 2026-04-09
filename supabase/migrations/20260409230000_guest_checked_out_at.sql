-- Факт выезда: карточка гостя остаётся в таблице.

alter table public.guests
  add column if not exists checked_out_at timestamptz;
