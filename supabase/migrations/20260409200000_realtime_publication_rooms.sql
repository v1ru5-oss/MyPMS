-- Трансляция изменений public.rooms в Realtime (статус уборки на шахматке).
-- Если миграция недоступна по правам, включите таблицу вручную: Dashboard → Database → Replication → rooms.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;
