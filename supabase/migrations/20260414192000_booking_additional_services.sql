create table if not exists public.booking_additional_services (
  booking_id text not null references public.bookings (id) on delete cascade,
  service_id uuid not null references public.additional_services (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (booking_id, service_id)
);

create or replace function public.touch_booking_additional_services_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_booking_additional_services_updated_at on public.booking_additional_services;
create trigger trg_booking_additional_services_updated_at
before update on public.booking_additional_services
for each row execute function public.touch_booking_additional_services_updated_at();

alter table public.booking_additional_services enable row level security;

drop policy if exists "booking_additional_services_anon_auth_all" on public.booking_additional_services;
create policy "booking_additional_services_anon_auth_all"
  on public.booking_additional_services for all
  to anon, authenticated
  using (true)
  with check (true);
