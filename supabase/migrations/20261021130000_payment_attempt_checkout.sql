-- Preserve legacy attempts; new requests carry an owned address and immutable quote.
alter table public.payment_attempts
  add column address_id uuid references public.addresses(id),
  add column request_hash text,
  add column checkout_snapshot jsonb,
  add constraint payment_attempt_checkout_binding check (
    (address_id is null and request_hash is null and checkout_snapshot is null)
    or (address_id is not null and request_hash ~ '^[0-9a-f]{64}$'
      and request_hash is not null and checkout_snapshot is not null
      and jsonb_typeof(checkout_snapshot) = 'object')
  );

-- Cart locking serializes double clicks, including requests with different keys.
-- This reserves a payment attempt only, not inventory. Finalization must revalidate.
create function public.checkout_reserve_payment_attempt(p_attempt jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_customer uuid := (p_attempt->>'customer_id')::uuid;
  v_cart uuid := (p_attempt->>'cart_id')::uuid;
  v_address uuid := (p_attempt->>'address_id')::uuid;
  v_row public.payment_attempts;
begin
  perform 1 from public.carts c join public.users u on u.id = c.customer_id
    where c.id = v_cart and c.customer_id = v_customer and c.status = 'ACTIVE'
      and u.status = 'ACTIVE' and u.role = 'CUSTOMER' for update of c;
  if not found then raise exception using errcode = 'P0011', message = 'Cart unavailable'; end if;

  select * into v_row from public.payment_attempts
    where customer_id = v_customer and idempotency_key = p_attempt->>'idempotency_key';
  if found then return to_jsonb(v_row); end if;

  perform 1 from public.addresses where id = v_address and customer_id = v_customer;
  if not found then raise exception using errcode = 'P0011', message = 'Address unavailable'; end if;
  if exists (select 1 from public.payment_attempts where cart_id = v_cart
      and status in ('PENDING', 'AUTHORIZED', 'CAPTURED')) then
    raise exception using errcode = 'P0010', message = 'Payment already in progress';
  end if;

  if (p_attempt->'checkout_snapshot'->>'cartId') is distinct from v_cart::text
    or (p_attempt->'checkout_snapshot'->>'addressId') is distinct from v_address::text
    or p_attempt->>'request_hash' is null or p_attempt->>'idempotency_key' is null then
    raise exception using errcode = '22023', message = 'Invalid checkout binding';
  end if;

  insert into public.payment_attempts (customer_id, cart_id, address_id, idempotency_key,
    request_hash, checkout_snapshot, subtotal_cents, delivery_fee_cents, tax_cents, total_cents)
  values (v_customer, v_cart, v_address, p_attempt->>'idempotency_key', p_attempt->>'request_hash',
    p_attempt->'checkout_snapshot', (p_attempt->>'subtotal_cents')::integer,
    (p_attempt->>'delivery_fee_cents')::integer, (p_attempt->>'tax_cents')::integer,
    (p_attempt->>'total_cents')::integer) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- Repeated attachment of the same Stripe ID is safe; replacing it is forbidden.
create function public.checkout_attach_payment_intent(p_customer_id uuid, p_attempt_id uuid, p_provider_id text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_provider_id is null or p_provider_id !~ '^pi_[A-Za-z0-9_-]+$' then
    raise exception using errcode = '22023', message = 'Invalid provider ID';
  end if;
  update public.payment_attempts set provider_payment_id = p_provider_id, updated_at = now()
    where id = p_attempt_id and customer_id = p_customer_id
      and (provider_payment_id is null or provider_payment_id = p_provider_id);
  if not found then raise exception using errcode = 'P0011', message = 'Payment unavailable'; end if;
end;
$$;

revoke execute on function public.checkout_reserve_payment_attempt(jsonb) from public, anon, authenticated;
revoke execute on function public.checkout_attach_payment_intent(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.checkout_reserve_payment_attempt(jsonb) to service_role;
grant execute on function public.checkout_attach_payment_intent(uuid, uuid, text) to service_role;
