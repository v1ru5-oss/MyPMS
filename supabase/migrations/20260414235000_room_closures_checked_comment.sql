alter table public.room_closures
  add column if not exists checked_comment text null;
