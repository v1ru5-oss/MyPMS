-- Кто выполнил заметку и кто удалил её с главной (для страницы «Заметки»).

alter table public.notes
  add column if not exists completed_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists completed_by_name text,
  add column if not exists deleted_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists deleted_by_name text;

create index if not exists notes_completed_by_user_id_idx
  on public.notes (completed_by_user_id) where completed_by_user_id is not null;

create index if not exists notes_deleted_by_user_id_idx
  on public.notes (deleted_by_user_id) where deleted_by_user_id is not null;
