create table if not exists public.guest_profiles (
  id text primary key,
  first_name text not null,
  last_name text not null,
  middle_name text null,
  citizenship_id smallint null references public.citizenships (id) on delete set null,
  phone text null,
  email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_guest_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_guest_profiles_updated_at on public.guest_profiles;
create trigger trg_guest_profiles_updated_at
before update on public.guest_profiles
for each row execute function public.touch_guest_profiles_updated_at();

alter table public.guest_profiles enable row level security;

drop policy if exists "guest_profiles_anon_auth_all" on public.guest_profiles;
create policy "guest_profiles_anon_auth_all"
  on public.guest_profiles for all
  to anon, authenticated
  using (true)
  with check (true);

alter table public.guests
  add column if not exists profile_id text null references public.guest_profiles (id) on delete set null;

insert into public.guest_profiles (id, first_name, last_name, middle_name, citizenship_id, phone, email)
select
  'gp-' || g.id,
  g.first_name,
  g.last_name,
  g.middle_name,
  g.citizenship_id,
  g.phone,
  g.email
from public.guests g
on conflict (id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  middle_name = excluded.middle_name,
  citizenship_id = excluded.citizenship_id,
  phone = excluded.phone,
  email = excluded.email;

update public.guests g
set profile_id = 'gp-' || g.id
where g.profile_id is null;

create or replace view public.guest_visits as
select *
from public.guests;
