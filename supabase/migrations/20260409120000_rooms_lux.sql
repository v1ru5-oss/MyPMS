-- Номера категории «люкс». Таблица public.rooms создаётся в 20260408120000_initial.sql.

insert into public.rooms (id, name, capacity, category) values
  ('lux-1', 'Номер 1', 2, 'люкс'),
  ('lux-2', 'Номер 2', 2, 'люкс'),
  ('lux-3', 'Номер 3', 2, 'люкс')
on conflict (id) do update set
  name = excluded.name,
  capacity = excluded.capacity,
  category = excluded.category;
