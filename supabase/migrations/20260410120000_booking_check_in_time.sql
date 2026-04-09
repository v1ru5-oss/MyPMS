-- Время заезда в день start_date (локальное время отеля, без часового пояса в БД).
alter table public.bookings
  add column if not exists check_in_time time without time zone null;

comment on column public.bookings.check_in_time is 'Время заезда в день start_date; null — с полуночи (как раньше только дата).';
