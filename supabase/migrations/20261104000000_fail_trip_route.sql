create function public.fail_trip_route(
  p_trip_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_assigned_count integer;
  v_invalid_count integer;
  v_returned_count integer;
begin
  if p_trip_id is null then
    raise exception 'Trip ID is required';
  end if;

  if p_failure_code is null
     or p_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'Invalid route failure code';
  end if;

  -- Lock the trip so updates don't overlap.
  select *
    into v_trip
    from public.trips
   where id = p_trip_id
   for update;

  if not found then
    raise exception 'Trip does not exist';
  end if;

  -- Don't add the same history twice.
  if v_trip.status = 'ROUTE_FAILED' then
    if exists (
      select 1 from public.orders where trip_id = p_trip_id
    ) then
      raise exception 'Failed trip still has assigned orders';
    end if;
    return;
  end if;

  if v_trip.status <> 'PLANNED' then
    raise exception 'Only PLANNED trips can fail routing';
  end if;

  if exists (
    select 1 from public.delivery_stops
     where trip_id = p_trip_id
  ) then
    raise exception 'Trip already has delivery stops';
  end if;

    perform 1
    from public.orders
   where trip_id = p_trip_id
   order by id
   for update;

  select
    count(*),
    count(*) filter (
      where status <> 'BATCHED' or paid_at is null
    )
    into v_assigned_count, v_invalid_count
    from public.orders
   where trip_id = p_trip_id;

  if v_assigned_count <> v_trip.order_count then
    raise exception 'Trip order count does not match';
  end if;

  if v_invalid_count > 0 then
    raise exception 'Trip has orders that cannot return to the queue';
  end if;

    -- Keep paid_at so queue order stays the same.
  with returned as (
    update public.orders
       set status = 'PAID',
           trip_id = null,
           updated_at = now()
     where trip_id = p_trip_id
       and status = 'BATCHED'
     returning id
  )
  insert into public.order_status_history (order_id, status, notes)
  select
    id,
    'PAID',
    'Returned to pending queue after route failure (' ||
      p_failure_code || ')'
  from returned;

  get diagnostics v_returned_count = row_count;

  if v_returned_count <> v_assigned_count then
    raise exception 'Could not return all trip orders to the queue';
  end if;

  update public.trips
     set status = 'ROUTE_FAILED',
         route_geometry = null
   where id = p_trip_id;

  raise log 'Route failed for trip %, code %, returned % orders',
    p_trip_id, p_failure_code, v_returned_count;
end;
$$;

revoke execute on function public.fail_trip_route(uuid, text)
  from public, anon, authenticated;

grant execute on function public.fail_trip_route(uuid, text)
  to service_role;
