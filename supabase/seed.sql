-- Local/demo seed data for the OFS project.
-- The password for all seeded users is: ChangeMe123!
-- Never use these accounts in production.

insert into public.categories (name, slug, is_active)
values
  ('Produce', 'produce', true),
  ('Dairy & Eggs', 'dairy-eggs', true),
  ('Bakery', 'bakery', true),
  ('Pantry', 'pantry', true),
  ('Beverages', 'beverages', true),
  ('Meat & Seafood', 'meat-seafood', true),
  ('Seasonal', 'seasonal', false)
on conflict (slug) do update
set name = excluded.name, is_active = excluded.is_active;

insert into public.products
  (sku, category_id, name, description, price_cents, unit_weight, stock_quantity, is_active)
select v.sku, c.id, v.name, v.description, v.price_cents, v.unit_weight, v.stock_quantity, v.is_active
from (values
  ('OFS-0001', 'produce', 'Organic Bananas', 'One bunch, about 6 bananas.', 249, 200, 25, true),
  ('OFS-0002', 'produce', 'Fuji Apples', '3 lb bag of crisp, sweet apples.', 599, 300, 25, true),
  ('OFS-0003', 'produce', 'Hass Avocados', 'Bag of 4, ready to eat in a day or two.', 499, 150, 25, true),
  ('OFS-0004', 'produce', 'Baby Spinach', 'Pre-washed, 10 oz clamshell.', 399, 63, 25, true),
  ('OFS-0005', 'produce', 'Russet Potatoes', '10 lb bag for mashing and baking.', 699, 1000, 25, true),
  ('OFS-0006', 'dairy-eggs', 'Whole Milk', 'One gallon, Grade A.', 499, 860, 25, true),
  ('OFS-0007', 'dairy-eggs', 'Large Eggs', 'One dozen cage-free brown eggs.', 549, 150, 25, true),
  ('OFS-0008', 'dairy-eggs', 'Greek Yogurt', 'Plain, 32 oz tub.', 649, 200, 25, true),
  ('OFS-0009', 'dairy-eggs', 'Sharp Cheddar', '8 oz block, aged 9 months.', 449, 50, 0, true),
  ('OFS-0010', 'bakery', 'Sourdough Bread', 'Fresh-baked loaf.', 699, 150, 25, true),
  ('OFS-0011', 'bakery', 'Butter Croissants', 'Pack of 4.', 599, 75, 25, true),
  ('OFS-0012', 'pantry', 'Jasmine Rice', '20 lb bag.', 2499, 2000, 25, true),
  ('OFS-0013', 'pantry', 'All-Purpose Flour', '50 lb bulk sack.', 3299, 5000, 25, true),
  ('OFS-0014', 'pantry', 'Spaghetti', '1 lb box of durum wheat pasta.', 199, 100, 25, true),
  ('OFS-0015', 'pantry', 'Marinara Sauce', '24 oz jar.', 549, 175, 25, true),
  ('OFS-0016', 'beverages', 'Spring Water', '24-pack of 16.9 oz bottles.', 799, 3500, 25, true),
  ('OFS-0017', 'beverages', 'Cold Brew Coffee', '32 oz bottle, unsweetened.', 899, 225, 25, true),
  ('OFS-0018', 'meat-seafood', 'Chicken Breast', 'Boneless, skinless, about 1.5 lb.', 1099, 150, 25, true),
  ('OFS-0019', 'meat-seafood', 'Atlantic Salmon', 'Fresh fillet, about 1 lb.', 1399, 100, 25, true),
  ('OFS-0020', 'pantry', 'Discontinued Granola', 'Retired product, never shown.', 599, 100, 10, false)
) as v(sku, category_slug, name, description, price_cents, unit_weight, stock_quantity, is_active)
join public.categories c on c.slug = v.category_slug
on conflict (sku) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  unit_weight = excluded.unit_weight,
  stock_quantity = excluded.stock_quantity,
  is_active = excluded.is_active,
  updated_at = now();

-- password_hash is an Argon2id hash of ChangeMe123! (src/lib/auth/password.ts).
insert into public.users (email, password_hash, role, status)
values
  ('customer.test@ofs.local', '$argon2id$v=19$m=19456,t=2,p=1$G0pjtSw4WIbV+e7B+W/zUg$oI/iKPBts8qU2gc+4TQYdkQcfishx9t2Fe0ua0zilxU', 'CUSTOMER', 'ACTIVE'),
  ('employee.test@ofs.local', '$argon2id$v=19$m=19456,t=2,p=1$G0pjtSw4WIbV+e7B+W/zUg$oI/iKPBts8qU2gc+4TQYdkQcfishx9t2Fe0ua0zilxU', 'EMPLOYEE', 'ACTIVE'),
  ('manager.test@ofs.local', '$argon2id$v=19$m=19456,t=2,p=1$G0pjtSw4WIbV+e7B+W/zUg$oI/iKPBts8qU2gc+4TQYdkQcfishx9t2Fe0ua0zilxU', 'MANAGER', 'ACTIVE'),
  ('vehicle.test@ofs.local', '$argon2id$v=19$m=19456,t=2,p=1$G0pjtSw4WIbV+e7B+W/zUg$oI/iKPBts8qU2gc+4TQYdkQcfishx9t2Fe0ua0zilxU', 'VEHICLE', 'ACTIVE')
on conflict (lower(email)) do update set
  password_hash = excluded.password_hash,
  role = excluded.role,
  status = excluded.status;

-- The demo robot, signed in as vehicle.test, parked at the store.
insert into public.vehicles (user_id, status, battery_percent, last_location, last_update_at)
select u.id, 'AVAILABLE', 100, extensions.st_point(-121.8811, 37.3352, 4326)::extensions.geography, now()
from public.users u
where u.email = 'vehicle.test@ofs.local'
on conflict (user_id) do nothing;

-- A default delivery address for customer.test (San Pedro Square, Downtown San Jose).
insert into public.addresses (customer_id, label, line_1, city, state, postal_code, location, is_default)
select u.id, 'Home', '87 N San Pedro St', 'San Jose', 'CA', '95110',
       extensions.st_point(-121.8945, 37.3361, 4326)::extensions.geography, true
from public.users u
where u.email = 'customer.test@ofs.local'
  and not exists (select 1 from public.addresses a where a.customer_id = u.id);
