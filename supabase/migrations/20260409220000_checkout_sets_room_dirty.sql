-- После выезда: на следующий календарный день после end_date номер — «не убран» (dirty).
-- Условие: end_date = вчера (как в шахматке: последний день проживания включительно).

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
        if new.cleaning_status = 'dirty' then
          new.cleaning_updated_by_label := 'Авто: выезд гостя';
        else
          new.cleaning_updated_by_label := 'Без входа';
        end if;
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
        if new.cleaning_status = 'dirty' then
          new.cleaning_updated_by_label := 'Авто: выезд гостя';
        else
          new.cleaning_updated_by_label := 'Без входа';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.apply_dirty_rooms_after_guest_checkout()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Календарный «вчера» в поясе отеля (как даты в карточках гостя / брони).
  y date := (current_timestamp at time zone 'Europe/Moscow')::date - 1;
begin
  update public.rooms r
  set cleaning_status = 'dirty'
  where r.cleaning_status is distinct from 'dirty'
    and r.id in (
      select distinct g.room_id
      from public.guests g
      where g.end_date = y
      union
      select distinct b.room_id
      from public.bookings b
      where b.end_date = y
    );
end;
$$;

grant execute on function public.apply_dirty_rooms_after_guest_checkout() to anon;
grant execute on function public.apply_dirty_rooms_after_guest_checkout() to authenticated;
grant execute on function public.apply_dirty_rooms_after_guest_checkout() to service_role;
