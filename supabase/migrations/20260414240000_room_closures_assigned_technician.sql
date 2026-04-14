alter table public.room_closures
  add column if not exists assigned_technician_user_id uuid null references public.profiles (id) on delete set null;

alter table public.room_closures
  add column if not exists assigned_technician_name text null;
