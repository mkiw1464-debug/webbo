-- FFEX License System v4 — run sekali dalam Supabase SQL Editor

-- Alter users table to add is_banned and created_by_admin
alter table public.users add column if not exists is_banned boolean not null default false;
alter table public.users add column if not exists created_by_admin uuid references public.users(id) on delete set null;

-- Alter licenses table to add product_tier
alter table public.licenses add column if not exists product_tier text not null default 'lite' check (product_tier in ('lite','pro'));

-- Full schema (for fresh installs)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','reseller')),
  credit_balance integer not null default 0,
  is_banned boolean not null default false,
  created_by_admin uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint users_credit_balance_nonneg check (credit_balance >= 0)
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text unique not null,
  license_type text not null default 'vip' check (license_type in ('global','vip')),
  product_tier text not null default 'lite' check (product_tier in ('lite','pro')),
  created_by uuid references public.users(id) on delete set null,
  duration_hours integer,
  duration_days integer,
  activated_at timestamptz,
  expires_at timestamptz,
  hwid text,
  status text not null default 'unused'
    check (status in ('unused','active','banned','expired')),
  created_at timestamptz not null default now()
);

create table if not exists public.device_logs (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  hwid text not null,
  ip_address text,
  validated_at timestamptz not null default now()
);

create index if not exists licenses_created_by_idx on public.licenses(created_by);
create index if not exists licenses_key_idx        on public.licenses(license_key);
create index if not exists licenses_status_idx     on public.licenses(status);
create index if not exists device_logs_license_idx on public.device_logs(license_id);
create index if not exists device_logs_hwid_idx    on public.device_logs(hwid);
create index if not exists users_role_idx          on public.users(role);

alter table public.users       enable row level security;
alter table public.licenses    enable row level security;
alter table public.device_logs enable row level security;

create or replace function public.increment_reseller_credit(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Credit amount must be positive'; end if;
  update public.users set credit_balance = credit_balance + p_amount
  where id = p_user_id and role in ('reseller','admin')
  returning credit_balance into new_balance;
  if new_balance is null then raise exception 'User not found'; end if;
  return new_balance;
end;$$;

create or replace function public.decrement_reseller_credit(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Credit amount must be positive'; end if;
  update public.users set credit_balance = credit_balance - p_amount
  where id = p_user_id and role in ('reseller','admin') and credit_balance >= p_amount
  returning credit_balance into new_balance;
  if new_balance is null then
    if exists (select 1 from public.users where id = p_user_id) then
      raise exception 'Insufficient credit';
    end if;
    raise exception 'User not found';
  end if;
  return new_balance;
end;$$;

grant execute on function public.increment_reseller_credit(uuid, integer) to service_role;
grant execute on function public.decrement_reseller_credit(uuid, integer) to service_role;
