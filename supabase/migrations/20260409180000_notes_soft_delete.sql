-- Мягкое удаление с главной: строка остаётся 7 дней, затем удаляется вместе с истёкшими выполненными.

alter table public.notes
  add column if not exists deleted_at timestamptz;

create index if not exists notes_deleted_at_idx on public.notes (deleted_at) where deleted_at is not null;

-- Счётчик удалённых строк через DELETE … RETURNING (без GET DIAGNOSTICS — надёжнее в SQL Editor Supabase).
create or replace function public.cleanup_completed_notes()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n1 integer;
  n2 integer;
begin
  with deleted as (
    delete from public.notes
    where is_completed = true
      and completed_at is not null
      and completed_at <= (now() - interval '7 days')
    returning id
  )
  select coalesce(count(*)::integer, 0) into n1 from deleted;

  with deleted as (
    delete from public.notes
    where deleted_at is not null
      and deleted_at <= (now() - interval '7 days')
    returning id
  )
  select coalesce(count(*)::integer, 0) into n2 from deleted;

  return coalesce(n1, 0) + coalesce(n2, 0);
end;
$function$;

grant execute on function public.cleanup_completed_notes() to anon, authenticated;
