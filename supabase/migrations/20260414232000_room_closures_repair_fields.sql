alter table public.room_closures
  add column if not exists repair_completed_at timestamptz null;

alter table public.room_closures
  add column if not exists resolved_issues text null;
