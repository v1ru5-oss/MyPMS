create table if not exists public.room_categories (
  name text primary key,
  weekday_price numeric(12, 2) not null default 0 check (weekday_price >= 0),
  weekend_price numeric(12, 2) not null default 0 check (weekend_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.room_categories
  add column if not exists weekday_price numeric(12, 2) not null default 0;

alter table public.room_categories
  add column if not exists weekend_price numeric(12, 2) not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'room_categories'
      and column_name = 'base_price'
  ) then
    execute '
      update public.room_categories
      set
        weekday_price = coalesce(weekday_price, base_price, 0),
        weekend_price = coalesce(weekend_price, base_price, 0)
    ';
  end if;
end
$$;

create or replace function public.touch_room_categories_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_room_categories_updated_at on public.room_categories;
create trigger trg_room_categories_updated_at
before update on public.room_categories
for each row execute function public.touch_room_categories_updated_at();

insert into public.room_categories (name, weekday_price, weekend_price)
select distinct trim(r.category), 0, 0
from public.rooms r
where r.category is not null and trim(r.category) <> ''
on conflict (name) do nothing;

insert into public.room_categories (name, weekday_price, weekend_price)
values ('Без категории', 0, 0)
on conflict (name) do nothing;

alter table public.room_categories enable row level security;

drop policy if exists "room_categories_anon_auth_all" on public.room_categories;
create policy "room_categories_anon_auth_all"
  on public.room_categories for all
  to anon, authenticated
  using (true)
  with check (true);
