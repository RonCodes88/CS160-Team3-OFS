-- Audit log for staff inventory and product changes, plus the transactional
-- function staff use to set a product's stock quantity.

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users (id),
  product_id    uuid not null references public.products (id),
  action        text not null check (action in (
                  'INVENTORY_SET_QUANTITY',
                  'PRODUCT_CREATE',
                  'PRODUCT_UPDATE',
                  'PRODUCT_RETIRE'
                )),
  old_value     jsonb,
  new_value     jsonb not null,
  created_at    timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_product_id_idx on public.audit_log (product_id, created_at desc);

alter table public.audit_log enable row level security;

-- Sets stock_quantity and writes the audit row in one transaction, so either
-- both happen or neither does. The actor comes from the server's session
-- lookup, never from the request body.
--
-- Errors (SQLSTATE):
--   22023 invalid quantity
--   42501 actor is not an active EMPLOYEE or MANAGER
--   P0002 product not found
-- Setting the current value again is a no-op and writes no audit row.
create function public.staff_set_inventory_quantity(
  p_actor_user_id uuid,
  p_product_id    uuid,
  p_quantity      integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old_quantity integer;
  v_updated_at   timestamptz;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity must be a non-negative integer' using errcode = '22023';
  end if;

  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.role in ('EMPLOYEE', 'MANAGER')
     and u.status = 'ACTIVE';
  if not found then
    raise exception 'actor is not active staff' using errcode = '42501';
  end if;

  -- Lock the row so concurrent updates (including checkout) serialize.
  select p.stock_quantity, p.updated_at
    into v_old_quantity, v_updated_at
    from public.products p
   where p.id = p_product_id
     for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if v_old_quantity <> p_quantity then
    update public.products p
       set stock_quantity = p_quantity,
           updated_at = now()
     where p.id = p_product_id
    returning p.updated_at into v_updated_at;

    insert into public.audit_log (actor_user_id, product_id, action, old_value, new_value)
    values (
      p_actor_user_id,
      p_product_id,
      'INVENTORY_SET_QUANTITY',
      jsonb_build_object('stock_quantity', v_old_quantity),
      jsonb_build_object('stock_quantity', p_quantity)
    );
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'old_quantity', v_old_quantity,
    'new_quantity', p_quantity,
    'changed', v_old_quantity <> p_quantity,
    'updated_at', v_updated_at
  );
end;
$$;

revoke execute on function public.staff_set_inventory_quantity(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.staff_set_inventory_quantity(uuid, uuid, integer)
  to service_role;
