-- Статус уборки номера: убрано (clean) / не убрано (dirty), NULL — без отметки.

alter table public.rooms
  add column if not exists cleaning_status text
  check (cleaning_status is null or cleaning_status in ('clean', 'dirty'));
