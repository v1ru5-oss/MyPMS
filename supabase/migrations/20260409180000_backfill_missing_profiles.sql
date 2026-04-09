-- Восстановить строки profiles для учёток Auth, у которых нет строки (триггер не сработал, ручной импорт и т.п.).
-- После выполнения выставьте роль admin / права вручную в таблице profiles при необходимости.

insert into public.profiles (id, email, username, role, can_manage_users, full_access)
select
  au.id,
  coalesce(au.email, ''),
  coalesce(
    nullif(trim(au.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(au.email, 'user@local'), '@', 1)
  ),
  case
    when trim(coalesce(au.raw_user_meta_data->>'role', '')) in ('admin', 'staff')
      then trim(au.raw_user_meta_data->>'role')
    else 'staff'
  end,
  coalesce((au.raw_user_meta_data->>'can_manage_users')::boolean, false),
  coalesce((au.raw_user_meta_data->>'full_access')::boolean, false)
from auth.users au
where not exists (select 1 from public.profiles p where p.id = au.id);
