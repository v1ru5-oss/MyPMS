-- Автор заметки (для отображения на главной и в попапе).

alter table public.notes
  add column if not exists created_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists created_by_name text;

create index if not exists notes_created_by_user_id_idx on public.notes (created_by_user_id) where created_by_user_id is not null;
