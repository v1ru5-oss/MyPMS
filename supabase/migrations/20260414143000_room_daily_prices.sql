create table if not exists public.room_daily_prices (
  room_id text not null references public.rooms (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, day_of_week)
);

create or replace function public.touch_room_daily_prices_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_room_daily_prices_updated_at on public.room_daily_prices;
create trigger trg_room_daily_prices_updated_at
before update on public.room_daily_prices
for each row execute function public.touch_room_daily_prices_updated_at();

alter table public.room_daily_prices enable row level security;

drop policy if exists "room_daily_prices_anon_auth_all" on public.room_daily_prices;
create policy "room_daily_prices_anon_auth_all"
  on public.room_daily_prices for all
  to anon, authenticated
  using (true)
  with check (true);
