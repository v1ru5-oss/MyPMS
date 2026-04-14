create table if not exists public.additional_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_additional_services_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_additional_services_updated_at on public.additional_services;
create trigger trg_additional_services_updated_at
before update on public.additional_services
for each row execute function public.touch_additional_services_updated_at();

alter table public.additional_services enable row level security;

drop policy if exists "additional_services_anon_auth_all" on public.additional_services;
create policy "additional_services_anon_auth_all"
  on public.additional_services for all
  to anon, authenticated
  using (true)
  with check (true);
