-- Lock the ACTIVE row before returning its ID. A checkout may have completed
-- while this request waited; retry against a fresh cart instead of editing history.
create or replace function public.customer_get_or_create_cart(p_customer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cart_id uuid;
begin
  perform 1 from public.users where id=p_customer_id and role='CUSTOMER' and status='ACTIVE';
  if not found then raise exception 'customer is not active' using errcode='42501'; end if;
  loop
    insert into public.carts(customer_id) values(p_customer_id)
      on conflict(customer_id) where status='ACTIVE' do nothing;
    select id into v_cart_id from public.carts
      where customer_id=p_customer_id and status='ACTIVE' for update;
    if found then return v_cart_id; end if;
  end loop;
end;
$$;

create or replace function public.customer_set_cart_item(p_customer_id uuid,p_product_id uuid,p_quantity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cart_id uuid; v_stock integer; v_unit_weight integer;
  v_previous_quantity integer; v_total_weight bigint;
begin
  if p_quantity is null or p_quantity<0 then
    raise exception 'quantity must be a non-negative integer' using errcode='22023';
  end if;
  v_cart_id := public.customer_get_or_create_cart(p_customer_id);
  select quantity into v_previous_quantity from public.cart_items
    where cart_id=v_cart_id and product_id=p_product_id;
  v_previous_quantity := coalesce(v_previous_quantity,0);
  if p_quantity=0 then
    delete from public.cart_items where cart_id=v_cart_id and product_id=p_product_id;
  else
    -- Category retirement must have the same meaning in cart and checkout.
    perform 1 from public.categories c join public.products p on p.category_id=c.id
      where p.id=p_product_id and c.is_active for share of c;
    if not found then raise exception 'product is not available' using errcode='P0002'; end if;
    select stock_quantity,unit_weight into v_stock,v_unit_weight from public.products
      where id=p_product_id and is_active for update;
    if not found then raise exception 'product is not available' using errcode='P0002'; end if;
    if p_quantity>v_stock then
      raise exception 'requested quantity exceeds available stock' using errcode='P0003';
    end if;
    insert into public.cart_items(cart_id,product_id,quantity) values(v_cart_id,p_product_id,p_quantity)
      on conflict(cart_id,product_id) do update set quantity=excluded.quantity,updated_at=now();
  end if;
  select coalesce(sum(ci.quantity::bigint*p.unit_weight),0) into v_total_weight
    from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=v_cart_id;
  -- A manager's weight change can make an existing cart overweight. Permit
  -- reductions so the shopper can repair it one line at a time. Checkout still
  -- rejects overweight carts. Increases always enforce the maximum.
  if v_total_weight>20000 and p_quantity>=v_previous_quantity then
    raise exception 'cart weight exceeds 200.00 lb' using errcode='P0004';
  end if;
  update public.carts set updated_at=now() where id=v_cart_id;
  return public.customer_get_cart(p_customer_id);
end;
$$;
