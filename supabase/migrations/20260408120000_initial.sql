-- MyPMS: профили, номера, гости, брони. RLS: только авторизованные клиенты.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  username text not null,
  role text not null check (role in ('admin', 'staff')) default 'staff',
  can_manage_users boolean not null default false,
  full_access boolean not null default false
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, role, can_manage_users, full_access)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      split_part(coalesce(new.email, 'user@local'), '@', 1)
    ),
    'staff',
    false,
    false
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.rooms (
  id text primary key,
  name text not null,
  capacity int not null check (capacity > 0),
  category text
);

alter table public.rooms enable row level security;

create policy "rooms_anon_auth_all"
  on public.rooms for all
  to anon, authenticated
  using (true)
  with check (true);

create table public.guests (
  id text primary key,
  first_name text not null,
  last_name text not null,
  room_id text not null references public.rooms (id) on delete restrict,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null,
  payment_method text not null check (payment_method in ('cash', 'transfer', 'unpaid')),
  approve boolean not null default false
);

alter table public.guests enable row level security;

create policy "guests_anon_auth_all"
  on public.guests for all
  to anon, authenticated
  using (true)
  with check (true);

create table public.bookings (
  id text primary key,
  room_id text not null references public.rooms (id) on delete restrict,
  guest_name text not null,
  start_date date not null,
  end_date date not null,
  note text,
  guest_id text references public.guests (id) on delete set null
);

alter table public.bookings enable row level security;

create policy "bookings_anon_auth_all"
  on public.bookings for all
  to anon, authenticated
  using (true)
  with check (true);

insert into public.rooms (id, name, capacity, category) values
  ('yalta-1', '1 (Основной) 1', 2, 'Дом Ялта'),
  ('yalta-2', '1 (Основной) 2', 2, 'Дом Ялта'),
  ('piter-1', '2 (Стандарт) 1', 3, 'Дом Питер'),
  ('piter-2', '2 (Стандарт) 2', 3, 'Дом Питер'),
  ('msk-101', '101', 2, 'Дом Москва'),
  ('msk-102', '102', 4, 'Дом Москва')
on conflict (id) do nothing;
