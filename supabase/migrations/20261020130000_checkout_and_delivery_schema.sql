-- Brings the schema in line with the LLD (Project Part 2, Data Design Details)
-- for the open checkout, order, delivery, tracking, and notification issues:
-- #18 #19 #20 #22 #26 #27 #28 #29 #30 #35 #36.
--
-- Deliberate differences from the LLD:
--   * Stock stays in products.stock_quantity (no separate inventory table),
--     as the staff inventory migration already decided.
--   * Primary keys are named id and stop status stays in a column named
--     status, matching the existing tables.
--   * vehicles.user_id links a robot to its VEHICLE login, so vehicle
--     endpoints can tell which robot is calling (#28, #29).
--   * trips.route_geometry stores the Mapbox GeoJSON line (#26).
--   * delivery_stops is unique on (trip_id, order_id) instead of order_id, so
--     an order can be routed again on a later trip.

-- ---------- Auth and Identity: addresses ----------

create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users (id) on delete cascade,
  label       text,
  line_1      text not null,
  line_2      text,
  city        text not null,
  state       text not null check (state ~ '^[A-Z]{2}$'),
  -- Text so leading zeroes are kept.
  postal_code text not null,
  -- Geocoded with Mapbox and checked against the service area before saving.
  location    extensions.geography(Point, 4326) not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index addresses_customer_idx on public.addresses (customer_id);
-- At most one default address per customer.
create unique index addresses_one_default_per_customer
  on public.addresses (customer_id) where is_default;

-- ---------- Cart: ACTIVE or CHECKED_OUT ----------

update public.carts set status = 'CHECKED_OUT' where status in ('CONVERTED', 'ABANDONED');
alter table public.carts drop constraint carts_status_check;
alter table public.carts
  add constraint carts_status_check check (status in ('ACTIVE', 'CHECKED_OUT'));

-- ---------- Trips ----------

update public.trips set status = 'OUT_FOR_DELIVERY' where status in ('DISPATCHED', 'IN_PROGRESS');
update public.trips set status = 'ROUTE_FAILED' where status = 'CANCELLED';
alter table public.trips drop constraint trips_status_check;
alter table public.trips
  add constraint trips_status_check
  check (status in ('PLANNED', 'ROUTED', 'OUT_FOR_DELIVERY', 'COMPLETED', 'ROUTE_FAILED'));

-- GeoJSON LineString from Mapbox ([lng, lat] pairs); null until routed.
alter table public.trips add column route_geometry jsonb;

-- ---------- Orders: created at payment, with checkout snapshots ----------

update public.orders set status = 'CANCELED' where status in ('CANCELLED', 'PENDING_PAYMENT');
alter table public.orders drop constraint orders_status_check;
alter table public.orders alter column status set default 'PAID';
alter table public.orders
  add constraint orders_status_check
  check (status in ('PAID', 'PREPARING', 'BATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED'));

alter table public.orders
  -- The saved address chosen at checkout; the snapshot below is what counts.
  add column address_id       uuid references public.addresses (id) on delete set null,
  -- Snapshot of the written address, so later address edits can't change the order.
  add column delivery_address jsonb not null,
  -- Snapshot of the geocoded delivery point, used for batching and routing.
  add column location         extensions.geography(Point, 4326) not null,
  -- Null until the order is batched into a trip.
  add column trip_id          uuid references public.trips (id),
  add column updated_at       timestamptz not null default now();

create index orders_customer_created_idx on public.orders (customer_id, created_at);
-- The batching job reads the oldest PAID orders and searches nearby ones.
create index orders_status_paid_at_idx on public.orders (status, paid_at);
create index orders_paid_location_idx on public.orders using gist (location) where status = 'PAID';
create index orders_trip_idx on public.orders (trip_id);

-- Every order status change writes a row here.
create table public.order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  status     text not null
             check (status in ('PAID', 'PREPARING', 'BATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED')),
  -- Null for automatic system changes.
  changed_by uuid references public.users (id),
  changed_at timestamptz not null default now(),
  -- Reason for a delay, failure, or cancellation.
  notes      text
);

create index order_status_history_order_idx on public.order_status_history (order_id, changed_at);

-- ---------- Checkout and Payment ----------

-- Only provider IDs and statuses are stored; card data never reaches OFS.
create table public.payment_attempts (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.users (id),
  cart_id             uuid not null references public.carts (id),
  -- Set after the order is created.
  order_id            uuid references public.orders (id),
  -- Stripe PaymentIntent ID.
  provider_payment_id text unique,
  idempotency_key     text not null unique,
  subtotal_cents      integer not null check (subtotal_cents >= 0),
  delivery_fee_cents  integer not null check (delivery_fee_cents >= 0),
  tax_cents           integer not null check (tax_cents >= 0),
  total_cents         integer not null check (total_cents >= 0),
  status              text not null default 'PENDING'
                      check (status in ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'VOIDED', 'REFUNDED')),
  -- Non-sensitive provider error code.
  failure_code        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index payment_attempts_customer_idx on public.payment_attempts (customer_id);
-- At most one payment is linked to an order.
create unique index payment_attempts_one_per_order
  on public.payment_attempts (order_id) where order_id is not null;

-- ---------- Route Optimization: delivery stops ----------

update public.delivery_stops set status = 'DELIVERED' where status = 'COMPLETED';
alter table public.delivery_stops drop constraint delivery_stops_status_check;
alter table public.delivery_stops
  add constraint delivery_stops_status_check
  check (status in ('PENDING', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DELAYED', 'FAILED'));

alter table public.delivery_stops drop constraint delivery_stops_order_id_key;
alter table public.delivery_stops
  add constraint delivery_stops_trip_id_order_id_key unique (trip_id, order_id);
create index delivery_stops_order_idx on public.delivery_stops (order_id);

alter table public.delivery_stops
  -- Copied from the order's location snapshot.
  add column location          extensions.geography(Point, 4326) not null,
  -- Null until the route is generated.
  add column estimated_arrival timestamptz;

-- ---------- Vehicle Tracking ----------

create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  -- The VEHICLE account the robot client signs in with.
  user_id         uuid not null unique references public.users (id),
  status          text not null default 'OFFLINE'
                  check (status in ('AVAILABLE', 'DELIVERING', 'OFFLINE')),
  battery_percent integer check (battery_percent between 0 and 100),
  -- Null when the robot isn't on a delivery trip.
  current_trip_id uuid references public.trips (id) on delete set null,
  last_location   extensions.geography(Point, 4326),
  last_update_at  timestamptz
);

create index vehicles_current_trip_idx on public.vehicles (current_trip_id);

-- ---------- Notifications ----------

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id),
  customer_id       uuid not null references public.users (id),
  notification_type text not null
                    check (notification_type in ('ORDER_CONFIRMED', 'READY_FOR_DELIVERY', 'DELIVERY_UPDATE', 'DELIVERED')),
  recipient_email   text not null,
  status            text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  error_message     text
);

create index notifications_order_idx on public.notifications (order_id);

-- Nothing is readable through the public API keys; the server uses the secret key.
alter table public.addresses enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.vehicles enable row level security;
alter table public.notifications enable row level security;
