-- Время выезда в день end_date (локальное время отеля, без часового пояса в БД).
alter table public.bookings
  add column if not exists check_out_time time without time zone null;

comment on column public.bookings.check_out_time is 'Время выезда в день end_date; null — до конца суток даты выезда (как раньше только дата).';
