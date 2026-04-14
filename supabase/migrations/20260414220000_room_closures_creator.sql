alter table public.room_closures
  add column if not exists created_by_user_id uuid null references public.profiles (id) on delete set null;

alter table public.room_closures
  add column if not exists created_by_name text null;
