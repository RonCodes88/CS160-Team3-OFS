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
  ('Meat & Seafood', 'meat-seafood', true)
on conflict (slug) do update
set name = excluded.name, is_active = excluded.is_active;

insert into public.products
  (sku, category_id, name, description, price_cents, unit_weight, stock_quantity, is_active)
select * from (values
  ('OFS-0001', 'produce', 'Organic Bananas', 'One bunch, about 6 bananas.', 249, 200, 25, true),
  ('OFS-0002', 'produce', 'Fuji Apples', '3 lb bag of crisp, sweet apples.', 599, 300, 25, true),
  ('OFS-0006', 'dairy-eggs', 'Whole Milk', 'One gallon, Grade A.', 499, 860, 25, true),
  ('OFS-0007', 'dairy-eggs', 'Large Eggs', 'One dozen cage-free brown eggs.', 549, 150, 25, true),
  ('OFS-0010', 'bakery', 'Sourdough Bread', 'Fresh-baked loaf.', 699, 150, 25, true),
  ('OFS-0012', 'pantry', 'Jasmine Rice', '20 lb bag.', 2499, 2000, 25, true),
  ('OFS-0016', 'beverages', 'Spring Water', '24-pack of 16.9 oz bottles.', 799, 3500, 25, true),
  ('OFS-0018', 'meat-seafood', 'Chicken Breast', 'Boneless, skinless, about 1.5 lb.', 1099, 150, 25, true)
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

insert into public.users (email, password_hash, role, status)
values
  ('customer.test@ofs.local', extensions.crypt('ChangeMe123!', extensions.gen_salt('bf')), 'CUSTOMER', 'ACTIVE'),
  ('employee.test@ofs.local', extensions.crypt('ChangeMe123!', extensions.gen_salt('bf')), 'EMPLOYEE', 'ACTIVE'),
  ('manager.test@ofs.local', extensions.crypt('ChangeMe123!', extensions.gen_salt('bf')), 'MANAGER', 'ACTIVE'),
  ('vehicle.test@ofs.local', extensions.crypt('ChangeMe123!', extensions.gen_salt('bf')), 'VEHICLE', 'ACTIVE')
on conflict (lower(email)) do update set
  password_hash = excluded.password_hash,
  role = excluded.role,
  status = excluded.status;
