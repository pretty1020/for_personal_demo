-- Smart AI Auditor — Supabase schema
-- Run in SQL Editor after creating a Supabase project.
-- Enable: Authentication > Email (password or magic link per your preference)

-- Extensions
create extension if not exists "pgcrypto";

-- App user profile (extends auth.users; satisfies "users" table for the app)
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  currency text not null default 'PHP',
  created_at timestamptz not null default now()
);

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  file_type text not null check (file_type in ('sales', 'inventory', 'expense', 'staff')),
  storage_path text not null,
  original_name text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'error')),
  error_message text,
  row_count integer,
  created_at timestamptz not null default now()
);

create index if not exists uploads_business_id_idx on public.uploads (business_id);

create table if not exists public.sales_data (
  id bigserial primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  upload_id uuid references public.uploads (id) on delete set null,
  sale_date date,
  sale_hour integer,
  item_name text,
  category text,
  quantity numeric,
  unit_price numeric,
  line_total numeric,
  cost numeric,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_data_business_date_idx on public.sales_data (business_id, sale_date);
create index if not exists sales_data_business_hour_idx on public.sales_data (business_id, sale_hour);

create table if not exists public.inventory_data (
  id bigserial primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  upload_id uuid references public.uploads (id) on delete set null,
  item_name text,
  sku text,
  quantity_on_hand numeric,
  unit_cost numeric,
  usage_quantity numeric,
  period_start date,
  period_end date,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_data_business_idx on public.inventory_data (business_id);

create table if not exists public.expense_data (
  id bigserial primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  upload_id uuid references public.uploads (id) on delete set null,
  expense_date date,
  category text,
  vendor text,
  description text,
  amount numeric,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists expense_data_business_date_idx on public.expense_data (business_id, expense_date);

create table if not exists public.staff_data (
  id bigserial primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  upload_id uuid references public.uploads (id) on delete set null,
  work_date date,
  employee_name text,
  hours_worked numeric,
  labor_cost numeric,
  shift_sales numeric,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_data_business_date_idx on public.staff_data (business_id, work_date);

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  severity text not null check (severity in ('High', 'Medium', 'Low')),
  category text not null check (category in ('Sales', 'Inventory', 'Labor', 'Expense', 'Menu')),
  title text not null,
  detail text not null,
  estimated_impact_php numeric,
  recommended_action text not null,
  source text not null default 'rule' check (source in ('rule', 'ai')),
  created_at timestamptz not null default now()
);

create index if not exists audit_findings_business_idx on public.audit_findings (business_id);

create table if not exists public.audit_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  report_type text not null check (report_type in ('executive_pdf', 'excel_summary', 'ai_run')),
  storage_path text,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- Sync auth.users -> public.users
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.users.display_name);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- RLS
alter table public.users enable row level security;
alter table public.businesses enable row level security;
alter table public.uploads enable row level security;
alter table public.sales_data enable row level security;
alter table public.inventory_data enable row level security;
alter table public.expense_data enable row level security;
alter table public.staff_data enable row level security;
alter table public.audit_findings enable row level security;
alter table public.audit_reports enable row level security;

-- Policies: owner-only by user_id on businesses chain
create policy "users_select_self" on public.users for select using (auth.uid() = id);
create policy "users_update_self" on public.users for update using (auth.uid() = id);

create policy "businesses_all_own" on public.businesses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "uploads_all_own" on public.uploads for all using (
  auth.uid() = user_id and exists (
    select 1 from public.businesses b where b.id = uploads.business_id and b.user_id = auth.uid()
  )
) with check (
  auth.uid() = user_id and exists (
    select 1 from public.businesses b where b.id = uploads.business_id and b.user_id = auth.uid()
  )
);

create policy "sales_data_all_own" on public.sales_data for all using (
  exists (select 1 from public.businesses b where b.id = sales_data.business_id and b.user_id = auth.uid())
) with check (
  exists (select 1 from public.businesses b where b.id = sales_data.business_id and b.user_id = auth.uid())
);

create policy "inventory_data_all_own" on public.inventory_data for all using (
  exists (select 1 from public.businesses b where b.id = inventory_data.business_id and b.user_id = auth.uid())
) with check (
  exists (select 1 from public.businesses b where b.id = inventory_data.business_id and b.user_id = auth.uid())
);

create policy "expense_data_all_own" on public.expense_data for all using (
  exists (select 1 from public.businesses b where b.id = expense_data.business_id and b.user_id = auth.uid())
) with check (
  exists (select 1 from public.businesses b where b.id = expense_data.business_id and b.user_id = auth.uid())
);

create policy "staff_data_all_own" on public.staff_data for all using (
  exists (select 1 from public.businesses b where b.id = staff_data.business_id and b.user_id = auth.uid())
) with check (
  exists (select 1 from public.businesses b where b.id = staff_data.business_id and b.user_id = auth.uid())
);

create policy "audit_findings_all_own" on public.audit_findings for all using (
  exists (select 1 from public.businesses b where b.id = audit_findings.business_id and b.user_id = auth.uid())
) with check (
  exists (select 1 from public.businesses b where b.id = audit_findings.business_id and b.user_id = auth.uid())
);

create policy "audit_reports_all_own" on public.audit_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket (create in Dashboard > Storage > New bucket "reports", private)
-- Then run policies below (adjust if bucket name differs)

insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

create policy "reports_select_own"
on storage.objects for select to authenticated
using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "reports_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "reports_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "reports_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
