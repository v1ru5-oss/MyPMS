alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'concierge', 'housekeeper', 'technician', 'senior_technician'));

alter table public.room_closures
  add column if not exists repaired_by_user_id uuid null references public.profiles (id) on delete set null;

alter table public.room_closures
  add column if not exists repaired_by_name text null;

alter table public.room_closures
  add column if not exists checked_at timestamptz null;

alter table public.room_closures
  add column if not exists checked_by_user_id uuid null references public.profiles (id) on delete set null;

alter table public.room_closures
  add column if not exists checked_by_name text null;

alter table public.room_closures
  add column if not exists checked_by_role text null;
