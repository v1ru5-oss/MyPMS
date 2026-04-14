-- Статус оплаты: не оплачен / оплачен (для гостя и брони; сводные данные опираются на бронь).

alter table public.guests
  add column if not exists payment_status text not null default 'unpaid'
  constraint guests_payment_status_check check (payment_status in ('unpaid', 'paid'));

update public.guests
set payment_status = case when payment_method = 'unpaid' then 'unpaid' else 'paid' end;

alter table public.bookings
  add column if not exists payment_status text not null default 'unpaid'
  constraint bookings_payment_status_check check (payment_status in ('unpaid', 'paid'));

update public.bookings b
set payment_status = g.payment_status
from public.guests g
where b.guest_id = g.id;

update public.bookings
set payment_status = 'unpaid'
where guest_id is null;
