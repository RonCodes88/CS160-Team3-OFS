-- Separate local test database only. Every fixture rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

create temporary table cart_fixture as
select gen_random_uuid() customer, gen_random_uuid() category, gen_random_uuid() product,
  gen_random_uuid() second_product;
insert into users (id,email,password_hash,role)
select customer, customer::text || '@cart-hardening.test', 'test-only', 'CUSTOMER' from cart_fixture;
insert into categories (id,name,slug)
select category,'Cart hardening',category::text from cart_fixture;
insert into products (id,category_id,sku,name,price_cents,unit_weight,stock_quantity)
select product,category,product::text,'Cart product',100,1,2147483647 from cart_fixture
union all select second_product,category,second_product::text,'Second product',100,1,2147483647 from cart_fixture;

select lives_ok('select customer_set_cart_item(customer,product,19999) from cart_fixture', 'accepts 199.99 lb');
select lives_ok('select customer_set_cart_item(customer,product,20000) from cart_fixture', 'accepts exactly 200 lb');
select throws_ok('select customer_set_cart_item(customer,product,20001) from cart_fixture',
  'P0004', 'cart weight exceeds 200.00 lb', 'rejects above 200 lb');
select throws_ok('select customer_set_cart_item(customer,product,2147483647) from cart_fixture',
  'P0004', 'cart weight exceeds 200.00 lb', 'large quantities return a capacity error');
select is((select quantity from cart_items where product_id=(select product from cart_fixture)),
  20000, 'rejected changes preserve quantity');

-- A manager can change weights after items entered a cart. Let the shopper repair it.
select customer_set_cart_item(customer,product,10000) from cart_fixture;
select customer_set_cart_item(customer,second_product,10000) from cart_fixture;
update products set unit_weight=10 where category_id=(select category from cart_fixture);
select throws_ok('select customer_set_cart_item(customer,product,2147483647) from cart_fixture',
  'P0004', 'cart weight exceeds 200.00 lb', 'weight multiplication cannot overflow integer capacity checks');
select lives_ok('select customer_set_cart_item(customer,product,0) from cart_fixture',
  'can remove an item even if remaining cart still exceeds capacity');
select lives_ok('select customer_set_cart_item(customer,second_product,5000) from cart_fixture',
  'can reduce an overweight cart toward capacity');
select throws_ok('select customer_set_cart_item(customer,second_product,5001) from cart_fixture',
  'P0004', 'cart weight exceeds 200.00 lb', 'cannot increase an overweight cart');
select customer_set_cart_item(customer,second_product,0) from cart_fixture;
update categories set is_active=false where id=(select category from cart_fixture);
select throws_ok('select customer_set_cart_item(customer,product,1) from cart_fixture',
  'P0002', 'product is not available', 'inactive categories cannot be added to carts');

select * from finish();
rollback;
