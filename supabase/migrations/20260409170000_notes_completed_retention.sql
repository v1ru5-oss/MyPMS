-- Выполненные заметки: перенос с главной на страницу "Заметки" и хранение 7 дней.

alter table public.notes
  add column if not exists is_completed boolean not null default false,
  add column if not exists completed_at timestamptz;

create index if not exists notes_is_completed_idx on public.notes (is_completed);
create index if not exists notes_completed_at_idx on public.notes (completed_at) where completed_at is not null;

create or replace function public.cleanup_completed_notes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.notes
  where is_completed = true
    and completed_at is not null
    and completed_at <= now() - interval '7 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_completed_notes() to anon, authenticated;
