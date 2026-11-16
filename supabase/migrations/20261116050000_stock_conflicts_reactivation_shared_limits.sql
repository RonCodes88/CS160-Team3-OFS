-- Three follow-ups from the readiness audit.
--   1. Staff stock edits can state the quantity they were looking at, so a
--      stale tab gets a conflict instead of silently overwriting newer stock.
--   2. Managers can reactivate a retired product (audited).
--   3. Sign-up and login limits have their own, larger budget for requests
--      whose client IP is unknown, so a room of people behind an app with no
--      trusted proxy is not locked out after 30 sign-ups.

-- ---------- 1. Stock edits with an expected quantity ----------
-- Errors (SQLSTATE): the same as the three-argument version, plus
--   P0021 the stock is no longer p_expected_quantity (someone changed it)
create function public.staff_set_inventory_quantity(
  p_actor_user_id     uuid,
  p_product_id        uuid,
  p_quantity          integer,
  p_expected_quantity integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_current integer;
begin
  if p_expected_quantity is not null then
    perform 1
      from public.users u
     where u.id = p_actor_user_id
       and u.role in ('EMPLOYEE', 'MANAGER')
       and u.status = 'ACTIVE';
    if not found then
      raise exception 'actor is not active staff' using errcode = '42501';
    end if;

    -- The lock is held until this transaction ends, so the value cannot
    -- change between this check and the update below.
    select p.stock_quantity into v_current
      from public.products p
     where p.id = p_product_id
       for update;
    if not found then
      raise exception 'product not found' using errcode = 'P0002';
    end if;
    if v_current <> p_expected_quantity then
      raise exception 'stock changed to %', v_current using errcode = 'P0021', detail = v_current::text;
    end if;
  end if;

  return public.staff_set_inventory_quantity(p_actor_user_id, p_product_id, p_quantity);
end;
$$;

revoke execute on function public.staff_set_inventory_quantity(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.staff_set_inventory_quantity(uuid, uuid, integer, integer)
  to service_role;

-- ---------- 2. Reactivating a retired product ----------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'INVENTORY_SET_QUANTITY',
  'PRODUCT_CREATE',
  'PRODUCT_UPDATE',
  'PRODUCT_RETIRE',
  'PRODUCT_REACTIVATE'
));

-- Sets is_active = true again. Reactivating an active product is a no-op.
create function public.admin_reactivate_product(p_actor_user_id uuid, p_product_id uuid)
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

  if (v_old->>'is_active')::boolean then
    return jsonb_build_object('changed', false, 'product', v_old);
  end if;

  update public.products p
     set is_active = true,
         updated_at = now()
   where p.id = p_product_id
  returning to_jsonb(p.*) into v_new;

  insert into public.audit_log (actor_user_id, product_id, action, old_value, new_value)
  values (
    p_actor_user_id,
    p_product_id,
    'PRODUCT_REACTIVATE',
    jsonb_build_object('is_active', false),
    jsonb_build_object('is_active', true)
  );

  return jsonb_build_object('changed', true, 'product', v_new);
end;
$$;

revoke execute on function public.admin_reactivate_product(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_reactivate_product(uuid, uuid)
  to service_role;

-- ---------- 3. Separate budgets when the client IP is unknown ----------
alter table public.auth_rate_limits drop constraint auth_rate_limits_scope_check;
alter table public.auth_rate_limits add constraint auth_rate_limits_scope_check check (scope in (
  'register-ip', 'login-ip', 'login-pair', 'login-account', 'register-shared', 'login-shared'
));

-- Same body as before; only the limits table gains the two shared scopes.
-- Per-account limits (login-pair, login-account) still stop password guessing.
create or replace function public.auth_consume_rate_limit(p_scope text,p_key_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v public.auth_rate_limits%rowtype; v_now timestamptz := clock_timestamp();
begin
  v_limit := case p_scope when 'register-ip' then 30 when 'login-ip' then 30
    when 'login-pair' then 10 when 'login-account' then 100
    when 'register-shared' then 300 when 'login-shared' then 600 end;
  if v_limit is null or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid auth limit' using errcode='22023';
  end if;
  -- Bounded housekeeping avoids indefinitely retaining expired identity hashes.
  delete from public.auth_rate_limits where (scope,key_hash) in (
    select scope,key_hash from public.auth_rate_limits where expires_at<=v_now
    order by expires_at limit 100 for update skip locked
  );
  insert into public.auth_rate_limits(scope,key_hash,expires_at)
    values(p_scope,p_key_hash,v_now+interval '15 minutes') on conflict do nothing;
  select * into v from public.auth_rate_limits where scope=p_scope and key_hash=p_key_hash for update;
  if v.expires_at<=v_now then
    update public.auth_rate_limits set attempts=0,expires_at=v_now+interval '15 minutes'
      where scope=p_scope and key_hash=p_key_hash returning * into v;
  end if;
  if v.attempts>=v_limit then
    return jsonb_build_object('ok',false,'retryAfterSeconds',greatest(1,ceil(extract(epoch from v.expires_at-v_now))::integer));
  end if;
  update public.auth_rate_limits set attempts=attempts+1 where scope=p_scope and key_hash=p_key_hash;
  return jsonb_build_object('ok',true);
end;
$$;
