-- Claim eligible orders atomically. A stale plan returns null for the next tick.
create function public.delivery_create_trip(p_order_ids uuid[], p_wait_minutes double precision)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
  v_weight bigint;
  v_oldest timestamptz;
  v_trip uuid;
begin
  if p_wait_minutes is null or p_wait_minutes <= 0 or p_wait_minutes >= 'Infinity'::double precision then
    raise exception 'Invalid wait limit';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 10
     or (select count(distinct id) from unnest(p_order_ids) id) <> cardinality(p_order_ids) then
    raise exception 'Invalid order IDs';
  end if;
  -- Deterministic lock order prevents overlapping plans from deadlocking.
  perform 1 from public.orders where id = any(p_order_ids) order by id for update;
  select count(*), sum(total_weight), min(paid_at) into v_count, v_weight, v_oldest
    from public.orders where id = any(p_order_ids)
      and status = 'PAID' and paid_at is not null and trip_id is null;
  if v_count <> cardinality(p_order_ids) then return null; end if;
  if v_weight > 20000 then raise exception 'Trip exceeds 200 lb'; end if;
  if v_count < 10 and v_weight < 20000
     and v_oldest > now() - make_interval(secs => p_wait_minutes * 60) then return null; end if;
  insert into public.trips(status, order_count, total_weight)
    values ('PLANNED', v_count, v_weight) returning id into v_trip;
  update public.orders set status = 'BATCHED', trip_id = v_trip, updated_at = now() where id = any(p_order_ids);
  insert into public.order_status_history(order_id, status, notes)
    select id, 'BATCHED', 'Assigned by delivery worker' from unnest(p_order_ids) id;
  return v_trip;
end;
$$;
revoke execute on function public.delivery_create_trip(uuid[], double precision) from public, anon, authenticated;
grant execute on function public.delivery_create_trip(uuid[], double precision) to service_role;
