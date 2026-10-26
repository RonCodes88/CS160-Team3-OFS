-- Durable recovery steps are separate from the externally meaningful payment status.
alter table public.payment_attempts
  add column finalize_step text not null default 'READY'
    check (finalize_step in ('READY','CAPTURE_PENDING','ORDER_PENDING','VOID_PENDING','REFUND_PENDING','DONE')),
  add column processing_token uuid,
  add column processing_until timestamptz,
  add column provider_refund_id text unique;

create function public.checkout_claim_finalization(p_attempt_id uuid, p_customer_id uuid, p_token uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v public.payment_attempts;
begin
  select * into v from public.payment_attempts where id = p_attempt_id and customer_id = p_customer_id for update;
  if not found then raise exception using errcode='P0021', message='Payment unavailable'; end if;
  if v.finalize_step = 'DONE' then return to_jsonb(v); end if;
  if v.processing_until > now() then raise exception using errcode='P0020', message='Payment busy'; end if;
  update public.payment_attempts set processing_token=p_token, processing_until=now()+interval '2 minutes', updated_at=now()
    where id=p_attempt_id returning * into v;
  return to_jsonb(v);
end;
$$;

create function public.checkout_release_finalization(p_attempt_id uuid, p_token uuid)
returns void language sql set search_path = '' as $$
  update public.payment_attempts set processing_token=null, processing_until=null
    where id=p_attempt_id and processing_token=p_token;
$$;

create function public.checkout_advance_finalization(p_attempt_id uuid, p_token uuid, p_step text,
  p_status text default null, p_failure_code text default null, p_refund_id text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare v public.payment_attempts;
begin
  select * into v from public.payment_attempts where id=p_attempt_id for update;
  if not found or v.processing_token is distinct from p_token then
    raise exception using errcode='P0020', message='Processing claim lost';
  end if;
  if not ((v.finalize_step='READY' and p_step in ('CAPTURE_PENDING','VOID_PENDING'))
    or (v.finalize_step='CAPTURE_PENDING' and p_step='ORDER_PENDING')
    or (v.finalize_step='ORDER_PENDING' and p_step='REFUND_PENDING' and v.order_id is null)
    or (v.finalize_step in ('READY','CAPTURE_PENDING','VOID_PENDING') and p_step='DONE' and p_status='VOIDED')
    or (v.finalize_step='REFUND_PENDING' and p_step='DONE' and p_status='REFUNDED' and p_refund_id is not null)) then
    raise exception using errcode='22023', message='Invalid payment transition';
  end if;
  update public.payment_attempts set finalize_step=p_step,
    status=case when p_step='CAPTURE_PENDING' then 'AUTHORIZED'
      when p_step='ORDER_PENDING' then 'CAPTURED' when p_step='DONE' then p_status else status end,
    failure_code=coalesce(p_failure_code,failure_code), provider_refund_id=coalesce(p_refund_id,provider_refund_id),
    processing_until=case when p_step='DONE' then null else now()+interval '2 minutes' end,
    processing_token=case when p_step='DONE' then null else processing_token end, updated_at=now()
    where id=p_attempt_id returning * into v;
  return to_jsonb(v);
end;
$$;

-- Order Service boundary: no external calls inside this transaction. Stripe capture
-- is already verified by Checkout. Repeated calls return the linked order.
create function public.order_create_from_payment(p_attempt_id uuid, p_token uuid,
  p_store_lat double precision, p_store_lng double precision, p_radius_meters double precision)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.payment_attempts; a public.addresses; v_order uuid; v_items jsonb;
  v_subtotal bigint; v_weight bigint; v_fee bigint; v_tax bigint;
  v_lat double precision; v_lng double precision; v_h double precision;
begin
  select * into v from public.payment_attempts where id=p_attempt_id for update;
  if not found then raise exception using errcode='P0021', message='Payment unavailable'; end if;
  if v.order_id is not null then return v.order_id; end if;
  if v.processing_token is distinct from p_token or v.finalize_step <> 'ORDER_PENDING' or v.status <> 'CAPTURED' then
    raise exception using errcode='P0020', message='Payment not ready for order creation';
  end if;
  if p_store_lat is null or p_store_lng is null or p_radius_meters is null
    or not (p_store_lat between -90 and 90) or not (p_store_lng between -180 and 180)
    or not (p_radius_meters > 0 and p_radius_meters < 'Infinity'::double precision) then
    raise exception using errcode='22023', message='Invalid service area';
  end if;
  perform 1 from public.carts where id=v.cart_id and customer_id=v.customer_id and status='ACTIVE' for update;
  if not found then raise exception using errcode='P0022', message='CART_UNAVAILABLE'; end if;
  perform 1 from public.users where id=v.customer_id and role='CUSTOMER' and status='ACTIVE' for share;
  if not found then raise exception using errcode='P0022', message='CHECKOUT_CHANGED'; end if;
  select * into a from public.addresses where id=v.address_id and customer_id=v.customer_id for update;
  if not found then raise exception using errcode='P0022', message='ADDRESS_INVALID'; end if;
  v_lat := extensions.st_y(a.location::extensions.geometry);
  v_lng := extensions.st_x(a.location::extensions.geometry);
  v_h := power(sin(radians(v_lat-p_store_lat)/2),2)
    + cos(radians(p_store_lat))*cos(radians(v_lat))*power(sin(radians(v_lng-p_store_lng)/2),2);
  if 2*6371000*asin(sqrt(least(1.0,greatest(0.0,v_h)))) > p_radius_meters
    or v_lat is distinct from (v.checkout_snapshot->'location'->>'lat')::double precision
    or v_lng is distinct from (v.checkout_snapshot->'location'->>'lng')::double precision
    or length(btrim(a.line_1))=0 or length(btrim(a.city))=0 or length(btrim(a.postal_code))=0 then
    raise exception using errcode='P0022', message='ADDRESS_INVALID';
  end if;
  -- Cart mutations also lock the cart. Lock catalog rows in stable order before
  -- checking availability and decrementing stock to prevent overselling.
  perform 1 from public.categories c where c.id in (
    select p.category_id from public.products p join public.cart_items ci on ci.product_id=p.id where ci.cart_id=v.cart_id
  ) order by c.id for share;
  perform 1 from public.products p join public.cart_items ci on ci.product_id=p.id
    where ci.cart_id=v.cart_id order by p.id for update of p;
  if not exists (select 1 from public.cart_items where cart_id=v.cart_id) then
    raise exception using errcode='P0022', message='CART_EMPTY';
  end if;
  if exists (select 1 from public.cart_items ci join public.products p on p.id=ci.product_id
      join public.categories c on c.id=p.category_id where ci.cart_id=v.cart_id and (not p.is_active or not c.is_active)) then
    raise exception using errcode='P0022', message='PRODUCT_UNAVAILABLE';
  end if;
  if exists (select 1 from public.cart_items ci join public.products p on p.id=ci.product_id
      where ci.cart_id=v.cart_id and ci.quantity>p.stock_quantity) then
    raise exception using errcode='P0022', message='INSUFFICIENT_STOCK';
  end if;
  select sum(ci.quantity::bigint*p.price_cents), sum(ci.quantity::bigint*p.unit_weight),
    jsonb_agg(jsonb_build_object('productId',p.id,'quantity',ci.quantity,'unitPriceCents',p.price_cents,'unitWeight',p.unit_weight) order by p.id)
    into v_subtotal,v_weight,v_items
    from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=v.cart_id;
  if v_weight>20000 then raise exception using errcode='P0022', message='CART_OVERWEIGHT'; end if;
  v_fee := case when v_weight>=2000 then 1000 else 0 end;
  v_tax := (v_subtotal+10)/20; -- 5% item-only tax; half-cent rounds up once.
  if v_items is distinct from v.checkout_snapshot->'items'
    or v_subtotal<>v.subtotal_cents or v_fee<>v.delivery_fee_cents or v_tax<>v.tax_cents
    or v_subtotal+v_fee+v_tax<>v.total_cents
    or v_weight is distinct from (v.checkout_snapshot->'totals'->>'totalWeight')::bigint then
    raise exception using errcode='P0022', message='CHECKOUT_CHANGED';
  end if;
  insert into public.orders (customer_id,status,subtotal_cents,delivery_fee_cents,tax_cents,total_cents,total_weight,paid_at,
    address_id,delivery_address,location)
  values (v.customer_id,'PAID',v_subtotal,v_fee,v_tax,v.total_cents,v_weight,now(),a.id,
    jsonb_build_object('line_1',a.line_1,'line_2',a.line_2,'city',a.city,'state',a.state,'postal_code',a.postal_code),a.location)
    returning id into v_order;
  insert into public.order_items (order_id,product_id,sku,product_name,unit_price_cents,unit_weight,quantity)
    select v_order,p.id,p.sku,p.name,p.price_cents,p.unit_weight,ci.quantity
    from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=v.cart_id;
  update public.products p set stock_quantity=p.stock_quantity-ci.quantity
    from public.cart_items ci where ci.cart_id=v.cart_id and p.id=ci.product_id;
  update public.carts set status='CHECKED_OUT' where id=v.cart_id;
  update public.payment_attempts set order_id=v_order,finalize_step='DONE',processing_token=null,processing_until=null,updated_at=now()
    where id=v.id;
  insert into public.order_status_history (order_id,status) values (v_order,'PAID');
  return v_order;
end;
$$;

revoke execute on function public.checkout_claim_finalization(uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.checkout_release_finalization(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.checkout_advance_finalization(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.order_create_from_payment(uuid,uuid,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.checkout_claim_finalization(uuid,uuid,uuid) to service_role;
grant execute on function public.checkout_release_finalization(uuid,uuid) to service_role;
grant execute on function public.checkout_advance_finalization(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.order_create_from_payment(uuid,uuid,double precision,double precision,double precision) to service_role;
