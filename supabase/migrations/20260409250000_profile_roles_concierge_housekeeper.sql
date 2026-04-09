-- Роли: admin, concierge, housekeeper. Бывший staff → concierge.

alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'concierge' where role = 'staff';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'concierge', 'housekeeper'));

alter table public.profiles alter column role set default 'concierge';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, role, can_manage_users, full_access)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'username'), ''),
      split_part(coalesce(new.email, 'user@local'), '@', 1)
    ),
    'concierge',
    false,
    false
  );
  return new;
end;
$$;
