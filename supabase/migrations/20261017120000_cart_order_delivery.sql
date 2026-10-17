-- Core cart, order, and delivery tables.
-- The identity and catalog tables are created by the earlier migrations.

create extension if not exists pgcrypto with schema extensions;

create table public.carts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id) on delete cascade,
  status      text not null default 'ACTIVE'
              check (status in ('ACTIVE', 'CONVERTED', 'ABANDONED')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A customer can have only one active cart. Historical carts are retained.
create unique index carts_one_active_per_customer_idx
  on public.carts (customer_id)
  where status = 'ACTIVE';

create index carts_customer_idx on public.carts (customer_id, created_at desc);

create table public.cart_items (
  cart_id    uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity   integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.users (id),
  status              text not null default 'PENDING_PAYMENT'
                      check (status in (
                        'PENDING_PAYMENT', 'PAID', 'BATCHED',
                        'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
                      )),
  subtotal_cents      integer not null default 0 check (subtotal_cents >= 0),
  delivery_fee_cents  integer not null default 0 check (delivery_fee_cents >= 0),
  tax_cents           integer not null default 0 check (tax_cents >= 0),
  total_cents         integer not null default 0 check (total_cents >= 0),
  total_weight        integer not null default 0
                      check (total_weight >= 0 and total_weight <= 20000),
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_paid_idx on public.orders (status, paid_at, id);

create table public.order_items (
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid not null references public.products (id),
  sku              text not null,
  product_name     text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_weight      integer not null check (unit_weight > 0),
  quantity         integer not null check (quantity > 0),
  primary key (order_id, product_id)
);

create table public.trips (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'PLANNED'
                 check (status in ('PLANNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  total_weight   integer not null default 0 check (total_weight >= 0 and total_weight <= 20000),
  order_count    integer not null default 0 check (order_count >= 0 and order_count <= 10),
  scheduled_at   timestamptz,
  dispatched_at  timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table public.delivery_stops (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips (id) on delete cascade,
  order_id       uuid not null unique references public.orders (id),
  stop_sequence  integer not null check (stop_sequence > 0),
  status         text not null default 'PENDING'
                 check (status in ('PENDING', 'ARRIVED', 'COMPLETED', 'FAILED')),
  arrived_at     timestamptz,
  completed_at   timestamptz,
  unique (trip_id, stop_sequence)
);

create index delivery_stops_trip_idx on public.delivery_stops (trip_id, stop_sequence);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.trips enable row level security;
alter table public.delivery_stops enable row level security;

-- Returns the active cart for a customer, creating it atomically when needed.
create function public.customer_get_or_create_cart(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
begin
  perform 1
    from public.users u
   where u.id = p_customer_id
     and u.role = 'CUSTOMER'
     and u.status = 'ACTIVE';
  if not found then
    raise exception 'customer is not active' using errcode = '42501';
  end if;

  insert into public.carts (customer_id)
  values (p_customer_id)
  on conflict (customer_id) where status = 'ACTIVE' do nothing;

  select c.id
    into v_cart_id
    from public.carts c
   where c.customer_id = p_customer_id
     and c.status = 'ACTIVE';

  return v_cart_id;
end;
$$;

-- Returns the customer cart without exposing exact stock counts.
create function public.customer_get_cart(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
  v_total_weight integer;
begin
  v_cart_id := public.customer_get_or_create_cart(p_customer_id);

  select coalesce(sum(ci.quantity * p.unit_weight), 0)
    into v_total_weight
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
   where ci.cart_id = v_cart_id;

  return jsonb_build_object(
    'cart_id', v_cart_id,
    'total_weight', v_total_weight,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', p.id,
          'sku', p.sku,
          'name', p.name,
          'description', p.description,
          'price_cents', p.price_cents,
          'unit_weight', p.unit_weight,
          'quantity', ci.quantity,
          'line_weight', ci.quantity * p.unit_weight
        ) order by p.name
      )
      from public.cart_items ci
      join public.products p on p.id = ci.product_id
      where ci.cart_id = v_cart_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Adds, updates, or removes one line while enforcing stock and the 200 lb limit.
-- Quantity 0 removes the item. All cart changes lock the cart row so concurrent
-- changes cannot bypass the weight limit.
create function public.customer_set_cart_item(
  p_customer_id uuid,
  p_product_id  uuid,
  p_quantity    integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id       uuid;
  v_stock         integer;
  v_unit_weight   integer;
  v_total_weight  integer;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity must be a non-negative integer' using errcode = '22023';
  end if;

  v_cart_id := public.customer_get_or_create_cart(p_customer_id);

  -- Serialize all changes to this customer's active cart.
  perform 1 from public.carts where id = v_cart_id for update;

  if p_quantity = 0 then
    delete from public.cart_items
     where cart_id = v_cart_id and product_id = p_product_id;
  else
    select p.stock_quantity, p.unit_weight
      into v_stock, v_unit_weight
      from public.products p
     where p.id = p_product_id
       and p.is_active = true
     for update;

    if not found then
      raise exception 'product is not available' using errcode = 'P0002';
    end if;

    if p_quantity > v_stock then
      raise exception 'requested quantity exceeds available stock' using errcode = 'P0003';
    end if;

    insert into public.cart_items (cart_id, product_id, quantity)
    values (v_cart_id, p_product_id, p_quantity)
    on conflict (cart_id, product_id)
    do update set quantity = excluded.quantity, updated_at = now();
  end if;

  select coalesce(sum(ci.quantity * p.unit_weight), 0)
    into v_total_weight
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
   where ci.cart_id = v_cart_id;

  if v_total_weight > 20000 then
    raise exception 'cart weight exceeds 200.00 lb' using errcode = 'P0004';
  end if;

  update public.carts set updated_at = now() where id = v_cart_id;
  return public.customer_get_cart(p_customer_id);
end;
$$;

revoke execute on function public.customer_get_or_create_cart(uuid) from public, anon, authenticated;
revoke execute on function public.customer_get_cart(uuid) from public, anon, authenticated;
revoke execute on function public.customer_set_cart_item(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.customer_get_or_create_cart(uuid) to service_role;
grant execute on function public.customer_get_cart(uuid) to service_role;
grant execute on function public.customer_set_cart_item(uuid, uuid, integer) to service_role;
