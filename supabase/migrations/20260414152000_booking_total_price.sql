alter table public.bookings
add column if not exists total_price numeric(12, 2);

update public.bookings b
set total_price = priced.total_price
from (
  select
    bk.id,
    coalesce(sum(rdp.price), 0)::numeric(12, 2) as total_price
  from public.bookings bk
  join lateral generate_series(bk.start_date, bk.end_date, interval '1 day') as stay_day(day) on true
  left join public.room_daily_prices rdp
    on rdp.room_id = bk.room_id
   and rdp.day_of_week = extract(dow from stay_day.day)::smallint
  group by bk.id
) as priced
where b.id = priced.id
  and b.total_price is null;
