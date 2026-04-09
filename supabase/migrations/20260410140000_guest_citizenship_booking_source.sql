-- Справочники: гражданство и источник брони; поля гостя и брони.

create table public.citizenships (
  id smallserial primary key,
  name text not null unique
);

create table public.booking_sources (
  id smallserial primary key,
  name text not null unique
);

alter table public.citizenships enable row level security;
alter table public.booking_sources enable row level security;

create policy "citizenships_select_authenticated"
  on public.citizenships for select
  to anon, authenticated
  using (true);

create policy "booking_sources_select_authenticated"
  on public.booking_sources for select
  to anon, authenticated
  using (true);

insert into public.citizenships (name) values
  ('Российская Федерация'),
  ('Республика Казахстан'),
  ('Республика Беларусь'),
  ('Украина'),
  ('Республика Узбекистан'),
  ('Республика Таджикистан'),
  ('Кыргызская Республика'),
  ('Республика Армения'),
  ('Азербайджанская Республика'),
  ('Республика Молдова'),
  ('Туркменистан'),
  ('Грузия'),
  ('Китайская Народная Республика'),
  ('Турция'),
  ('Индия'),
  ('Германия'),
  ('Франция'),
  ('Соединённые Штаты Америки'),
  ('Великобритания'),
  ('Италия'),
  ('Испания'),
  ('Польша'),
  ('Литва'),
  ('Латвия'),
  ('Эстония'),
  ('Финляндия'),
  ('Швеция'),
  ('Норвегия'),
  ('Нидерланды'),
  ('Греция'),
  ('Израиль'),
  ('ОАЭ'),
  ('Египет'),
  ('Таиланд'),
  ('Вьетнам'),
  ('Япония'),
  ('Республика Корея'),
  ('Канада'),
  ('Австралия'),
  ('Иное')
on conflict (name) do nothing;

insert into public.booking_sources (name) values
  ('Яндекс'),
  ('Сайт')
on conflict (name) do nothing;

alter table public.guests
  add column if not exists middle_name text null,
  add column if not exists citizenship_id smallint null references public.citizenships (id) on delete set null,
  add column if not exists phone text null,
  add column if not exists email text null;

alter table public.bookings
  add column if not exists booking_source_id smallint null references public.booking_sources (id) on delete set null;

comment on column public.guests.middle_name is 'Отчество (опционально).';
comment on column public.guests.citizenship_id is 'Гражданство из справочника citizenships.';
comment on column public.guests.phone is 'Контактный телефон.';
comment on column public.guests.email is 'Электронная почта.';
comment on column public.bookings.booking_source_id is 'Источник брони из справочника booking_sources.';
