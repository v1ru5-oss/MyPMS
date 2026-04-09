-- Кто и когда менял статус уборки. Подпись (label) пишет триггер из profiles — без join и RLS для anon.

alter table public.rooms
  add column if not exists cleaning_updated_at timestamptz;

alter table public.rooms
  add column if not exists cleaning_updated_by uuid references public.profiles (id) on delete set null;

alter table public.rooms
  add column if not exists cleaning_updated_by_label text;

create or replace function public.rooms_set_cleaning_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_username text;
  v_email text;
begin
  v_uid := auth.uid();

  if tg_op = 'INSERT' then
    if new.cleaning_status is not null then
      new.cleaning_updated_at := now();
      new.cleaning_updated_by := v_uid;
      if v_uid is not null then
        select p.username, p.email into v_username, v_email
        from public.profiles p
        where p.id = v_uid;
        new.cleaning_updated_by_label := coalesce(
          nullif(trim(v_username), ''),
          nullif(trim(v_email), ''),
          'Неизвестно'
        );
      else
        new.cleaning_updated_by_label := 'Без входа';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.cleaning_status is distinct from old.cleaning_status then
      new.cleaning_updated_at := now();
      new.cleaning_updated_by := v_uid;
      if v_uid is not null then
        select p.username, p.email into v_username, v_email
        from public.profiles p
        where p.id = v_uid;
        new.cleaning_updated_by_label := coalesce(
          nullif(trim(v_username), ''),
          nullif(trim(v_email), ''),
          'Неизвестно'
        );
      else
        new.cleaning_updated_by_label := 'Без входа';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_cleaning_audit on public.rooms;

create trigger rooms_cleaning_audit
  before insert or update on public.rooms
  for each row
  execute function public.rooms_set_cleaning_audit();
