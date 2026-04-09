-- Заметки-стикеры: привязка к номеру и/или гостю, опциональный дедлайн.

create table public.notes (
  id text primary key,
  body text not null check (length(trim(body)) > 0),
  room_id text references public.rooms (id) on delete cascade,
  guest_id text references public.guests (id) on delete cascade,
  deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_room_id_idx on public.notes (room_id) where room_id is not null;
create index notes_guest_id_idx on public.notes (guest_id) where guest_id is not null;
create index notes_deadline_idx on public.notes (deadline_at) where deadline_at is not null;

alter table public.notes enable row level security;

create policy "notes_anon_auth_all"
  on public.notes for all
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.set_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_notes_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;
