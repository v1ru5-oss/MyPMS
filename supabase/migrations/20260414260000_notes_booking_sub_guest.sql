-- Привязка заметки к конкретному проживающему из списка субгостей брони (не только к карточке Guest).

alter table public.notes
  add column if not exists booking_sub_guest_id text null
  references public.booking_sub_guests (id) on delete set null;

create index if not exists notes_booking_sub_guest_id_idx
  on public.notes (booking_sub_guest_id)
  where booking_sub_guest_id is not null;
