-- Manager product changes (create, update, retire). Each function changes
-- products and writes the audit_log row in one transaction. The actor comes
-- from the server's session lookup, never from the request body.
--
-- Errors (SQLSTATE):
--   22023 invalid input (unknown or missing fields)
--   42501 actor is not an active MANAGER
--   P0002 product not found
--   23505 duplicate SKU, 23503 unknown category, 23514 CHECK failed

-- Safety nets for values the API already validates.
alter table public.products
  add constraint products_sku_not_blank check (length(btrim(sku)) > 0),
  add constraint products_name_not_blank check (length(btrim(name)) > 0);

create function public.assert_active_manager(p_actor_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.role = 'MANAGER'
     and u.status = 'ACTIVE';
  if not found then
    raise exception 'actor is not an active manager' using errcode = '42501';
  end if;
end;
$$;

-- p_product keys: sku, category_id, name, price_cents, unit_weight (required);
-- description, image_url, stock_quantity (optional).
create function public.admin_create_product(p_actor_user_id uuid, p_product jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb;
begin
  perform public.assert_active_manager(p_actor_user_id);

  if p_product is null
     or not p_product ?& array['sku', 'category_id', 'name', 'price_cents', 'unit_weight'] then
    raise exception 'missing required product fields' using errcode = '22023';
  end if;

  insert into public.products as p
    (sku, category_id, name, description, image_url, price_cents, unit_weight, stock_quantity)
  values (
    p_product->>'sku',
    (p_product->>'category_id')::uuid,
    p_product->>'name',
    coalesce(p_product->>'description', ''),
    p_product->>'image_url',
    (p_product->>'price_cents')::integer,
    (p_product->>'unit_weight')::integer,
    coalesce((p_product->>'stock_quantity')::integer, 0)
  )
  returning to_jsonb(p.*) into v_new;

  insert into public.audit_log (actor_user_id, product_id, action, old_value, new_value)
  values (p_actor_user_id, (v_new->>'id')::uuid, 'PRODUCT_CREATE', null, v_new);

  return v_new;
end;
$$;

-- p_changes may contain any of: sku, category_id, name, description,
-- image_url, price_cents, unit_weight. Stock and is_active have their own paths.
-- Only fields whose value actually changes are written and audited.
create function public.admin_update_product(
  p_actor_user_id uuid,
  p_product_id    uuid,
  p_changes       jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_allowed constant text[] := array[
    'sku', 'category_id', 'name', 'description', 'image_url', 'price_cents', 'unit_weight'
  ];
  v_old     jsonb;
  v_diff    jsonb;
  v_before  jsonb;
  v_new     jsonb;
begin
  perform public.assert_active_manager(p_actor_user_id);

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes given' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (c_allowed)) then
    raise exception 'unknown or read-only product field' using errcode = '22023';
  end if;

  select to_jsonb(p.*) into v_old
    from public.products p
   where p.id = p_product_id
     for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb),
         coalesce(jsonb_object_agg(e.key, v_old -> e.key), '{}'::jsonb)
    into v_diff, v_before
    from jsonb_each(p_changes) e
   where v_old -> e.key is distinct from e.value;

  if v_diff = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'product', v_old);
  end if;

  update public.products p
     set sku         = case when v_diff ? 'sku' then v_diff->>'sku' else p.sku end,
         category_id = case when v_diff ? 'category_id' then (v_diff->>'category_id')::uuid else p.category_id end,
         name        = case when v_diff ? 'name' then v_diff->>'name' else p.name end,
         description = case when v_diff ? 'description' then v_diff->>'description' else p.description end,
         image_url   = case when v_diff ? 'image_url' then v_diff->>'image_url' else p.image_url end,
         price_cents = case when v_diff ? 'price_cents' then (v_diff->>'price_cents')::integer else p.price_cents end,
         unit_weight = case when v_diff ? 'unit_weight' then (v_diff->>'unit_weight')::integer else p.unit_weight end,
         updated_at  = now()
   where p.id = p_product_id
  returning to_jsonb(p.*) into v_new;

  insert into public.audit_log (actor_user_id, product_id, action, old_value, new_value)
  values (p_actor_user_id, p_product_id, 'PRODUCT_UPDATE', v_before, v_diff);

  return jsonb_build_object('changed', true, 'product', v_new);
end;
$$;

-- Retires a product (is_active = false). Products are never deleted, so past
-- orders keep valid product IDs. Retiring an already-retired product is a no-op.
create function public.admin_retire_product(p_actor_user_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  perform public.assert_active_manager(p_actor_user_id);

  select to_jsonb(p.*) into v_old
    from public.products p
   where p.id = p_product_id
     for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if not (v_old->>'is_active')::boolean then
    return jsonb_build_object('changed', false, 'product', v_old);
  end if;

  update public.products p
     set is_active = false,
         updated_at = now()
   where p.id = p_product_id
  returning to_jsonb(p.*) into v_new;

  insert into public.audit_log (actor_user_id, product_id, action, old_value, new_value)
  values (
    p_actor_user_id,
    p_product_id,
    'PRODUCT_RETIRE',
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false)
  );

  return jsonb_build_object('changed', true, 'product', v_new);
end;
$$;

revoke execute on function public.assert_active_manager(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_create_product(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.admin_update_product(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.admin_retire_product(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.assert_active_manager(uuid) to service_role;
grant execute on function public.admin_create_product(uuid, jsonb) to service_role;
grant execute on function public.admin_update_product(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_retire_product(uuid, uuid) to service_role;
