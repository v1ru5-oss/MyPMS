alter table public.bookings
  add column if not exists guests_count int not null default 1 check (guests_count >= 1);

alter table public.bookings
  add column if not exists children_count int not null default 0 check (children_count >= 0);

create table if not exists public.booking_sub_guests (
  id text primary key,
  booking_id text not null references public.bookings (id) on delete cascade,
  position int not null check (position >= 2),
  last_name text not null default '',
  first_name text not null default '',
  middle_name text null,
  passport_data text null,
  is_child boolean not null default false,
  age int null check (age is null or age >= 0),
  birth_certificate text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, position)
);

create index if not exists idx_booking_sub_guests_booking_id on public.booking_sub_guests (booking_id);

create or replace function public.touch_booking_sub_guests_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_booking_sub_guests_updated_at on public.booking_sub_guests;
create trigger trg_booking_sub_guests_updated_at
before update on public.booking_sub_guests
for each row execute function public.touch_booking_sub_guests_updated_at();

alter table public.booking_sub_guests enable row level security;

drop policy if exists "booking_sub_guests_anon_auth_all" on public.booking_sub_guests;
create policy "booking_sub_guests_anon_auth_all"
  on public.booking_sub_guests for all
  to anon, authenticated
  using (true)
  with check (true);
