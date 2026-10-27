-- Run with `npx supabase test db`. All fixtures and fault injection roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

create temporary table checkout_fixture as
select gen_random_uuid() as customer, gen_random_uuid() as category,
  gen_random_uuid() as product, gen_random_uuid() as cart,
  gen_random_uuid() as address, gen_random_uuid() as attempt,
  gen_random_uuid() as token;

insert into public.users (id, email, password_hash, role)
select customer, customer::text || '@rollback.test', 'test-only', 'CUSTOMER' from checkout_fixture;
insert into public.categories (id, name, slug)
select category, 'Rollback test', category::text from checkout_fixture;
insert into public.products (id, category_id, sku, name, price_cents, unit_weight, stock_quantity)
select product, category, product::text, 'Rollback product', 250, 1000, 5 from checkout_fixture;
insert into public.carts (id, customer_id)
select cart, customer from checkout_fixture;
insert into public.cart_items (cart_id, product_id, quantity)
select cart, product, 2 from checkout_fixture;
insert into public.addresses (id, customer_id, line_1, city, state, postal_code, location)
select address, customer, 'Test street', 'Test city', 'CA', '00000',
  'SRID=4326;POINT(0 0)'::extensions.geography from checkout_fixture;

-- Model an already captured payment; this SQL test never calls Stripe.
insert into public.payment_attempts (id, customer_id, cart_id, address_id,
  provider_payment_id, idempotency_key, request_hash, checkout_snapshot,
  subtotal_cents, delivery_fee_cents, tax_cents, total_cents,
  status, finalize_step, processing_token, processing_until)
select attempt, customer, cart, address, 'pi_test_' || attempt, attempt::text,
  repeat('a', 64), jsonb_build_object(
    'location', jsonb_build_object('lat', 0, 'lng', 0),
    'items', jsonb_build_array(jsonb_build_object('productId', product,
      'quantity', 2, 'unitPriceCents', 250, 'unitWeight', 1000)),
    'totals', jsonb_build_object('totalWeight', 2000)),
  500, 1000, 25, 1525, 'CAPTURED', 'ORDER_PENDING', token, now() + interval '2 minutes'
from checkout_fixture;

create temporary table original_cart as
select c.* from public.carts c join checkout_fixture f on c.id = f.cart;
create temporary table original_payment as
select p.* from public.payment_attempts p join checkout_fixture f on p.id = f.attempt;

create function pg_temp.fail_checkout_history() returns trigger language plpgsql as $$
declare f record;
begin
  select * into f from pg_temp.checkout_fixture;
  if exists (select 1 from public.orders where id = new.order_id and customer_id = f.customer) then
    -- Verify the fault occurs AFTER order/items, inventory, cart and payment writes.
    if (select count(*) from public.order_items where order_id = new.order_id) <> 1
      or (select stock_quantity from public.products where id = f.product) <> 3
      or (select status from public.carts where id = f.cart) <> 'CHECKED_OUT'
      or not exists (select 1 from public.payment_attempts where id = f.attempt
        and order_id = new.order_id and finalize_step = 'DONE') then
      raise exception 'Fault injection did not reach all checkout writes';
    end if;
    raise exception using errcode = 'P0099', message = 'Injected final history failure';
  end if;
  return new;
end;
$$;
create trigger test_checkout_history_failure before insert on public.order_status_history
for each row execute function pg_temp.fail_checkout_history();

select throws_ok(
  'select public.order_create_from_payment(attempt, token, 0, 0, 1000) from checkout_fixture',
  'P0099', 'Injected final history failure', 'late history failure aborts checkout');
select is((select count(*) from public.orders where customer_id = (select customer from checkout_fixture)),
  0::bigint, 'inserted order rolls back');
select is((select count(*) from public.order_items where product_id = (select product from checkout_fixture)),
  0::bigint, 'inserted order items roll back');
select is((select stock_quantity from public.products where id = (select product from checkout_fixture)),
  5, 'stock deduction rolls back');
select results_eq('select c.* from public.carts c join checkout_fixture f on c.id = f.cart',
  'select * from original_cart', 'cart remains unchanged');
select results_eq('select p.* from public.payment_attempts p join checkout_fixture f on p.id = f.attempt',
  'select * from original_payment', 'payment link and finalization state roll back');
select is((select count(*) from public.notifications where customer_id = (select customer from checkout_fixture)),
  0::bigint, 'failed checkout leaves no receipt notification');
select is((select quantity from public.cart_items where cart_id = (select cart from checkout_fixture)),
  2, 'cart contents remain available for recovery');

-- The same captured attempt can recover once the database fault is removed.
drop trigger test_checkout_history_failure on public.order_status_history;
select lives_ok('select public.order_create_from_payment(attempt, token, 0, 0, 1000) from checkout_fixture',
  'retry succeeds after the fault is removed');
select is((select stock_quantity from public.products where id = (select product from checkout_fixture)),
  3, 'successful recovery deducts stock once');
select is((select count(*) from public.orders where customer_id = (select customer from checkout_fixture)),
  1::bigint, 'successful recovery creates exactly one order');

select * from finish();
rollback;
