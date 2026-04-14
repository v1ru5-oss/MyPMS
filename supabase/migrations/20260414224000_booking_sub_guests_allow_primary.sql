do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'booking_sub_guests_position_check'
  ) then
    alter table public.booking_sub_guests
      drop constraint booking_sub_guests_position_check;
  end if;
exception
  when undefined_object then null;
end
$$;

alter table public.booking_sub_guests
  drop constraint if exists booking_sub_guests_position_check;

alter table public.booking_sub_guests
  add constraint booking_sub_guests_position_check check (position >= 1);
