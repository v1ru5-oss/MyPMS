create table if not exists public.room_closures (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_closures_range_chk check (end_at >= start_at)
);

create index if not exists idx_room_closures_room_id on public.room_closures (room_id);
create index if not exists idx_room_closures_start_at on public.room_closures (start_at);
create index if not exists idx_room_closures_end_at on public.room_closures (end_at);

create or replace function public.touch_room_closures_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_room_closures_updated_at on public.room_closures;
create trigger trg_room_closures_updated_at
before update on public.room_closures
for each row execute function public.touch_room_closures_updated_at();

alter table public.room_closures enable row level security;

drop policy if exists "room_closures_anon_auth_all" on public.room_closures;
create policy "room_closures_anon_auth_all"
  on public.room_closures for all
  to anon, authenticated
  using (true)
  with check (true);
