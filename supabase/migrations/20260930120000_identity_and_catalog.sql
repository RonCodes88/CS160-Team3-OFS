-- Core identity and catalog tables, copied from the LLD so staff inventory
-- work is not blocked. Auth and Catalog owners extend these in new migrations.

create extension if not exists pg_trgm with schema extensions;

-- ---------- Auth and Identity ----------

create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  role          text not null default 'CUSTOMER'
                check (role in ('CUSTOMER', 'EMPLOYEE', 'MANAGER', 'VEHICLE')),
  status        text not null default 'ACTIVE'
                check (status in ('ACTIVE', 'DISABLED', 'LOCKED')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index users_email_lower_key on public.users (lower(email));

create table public.auth_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_sessions_user_id_idx on public.auth_sessions (user_id);

-- ---------- Catalog ----------

create table public.categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      text not null unique,
  is_active boolean not null default true
);

-- stock_quantity is the single source of truth for stock. There is no
-- separate inventory table.
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  sku            text not null unique,
  category_id    uuid not null references public.categories (id),
  name           text not null,
  description    text not null default '',
  image_url      text,
  price_cents    integer not null check (price_cents >= 0),
  unit_weight    integer not null check (unit_weight > 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);

create index products_category_active_idx on public.products (category_id, is_active);
create index products_stock_quantity_idx on public.products (stock_quantity);
create index products_name_trgm_idx on public.products
  using gin (name extensions.gin_trgm_ops);
create index products_description_trgm_idx on public.products
  using gin (description extensions.gin_trgm_ops);

-- Nothing is readable through the public API keys by default. The server uses
-- the secret key, which bypasses RLS, and checks sessions and roles in code.
alter table public.users enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
