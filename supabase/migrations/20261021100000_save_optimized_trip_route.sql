-- Save the optimized route in one transaction, accessible only by the backend service role.
create function public.save_optimized_trip_route(
  p_trip_id uuid,
  p_geometry jsonb,
  p_stops jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_count integer;
  v_assigned_count integer;
  v_inserted integer;
  v_unique_orders integer;
  v_unique_sequences integer;
  v_min_sequence integer;
  v_max_sequence integer;
  v_invalid integer;
  v_point jsonb;
  v_coordinates jsonb;
begin
  if p_trip_id is null then
    raise exception 'Trip ID is required';
  end if;

  -- Lock the trip so another request can't update it at the same time.
  select *
    into v_trip
    from public.trips
   where id = p_trip_id
   for update;

  if not found then
    raise exception 'Trip does not exist';
  end if;

  if v_trip.status <> 'PLANNED' then
    raise exception 'Only PLANNED trips can be routed';
  end if;

  if jsonb_typeof(p_stops) is distinct from 'array' then
    raise exception 'Stops must be an array';
  end if;

  v_count := jsonb_array_length(p_stops);

  if v_count < 1 or v_count > 10 or
     v_count <> v_trip.order_count then
    raise exception 'Invalid delivery stop count';
  end if;

  -- Check for duplicate orders, missing data, and incorrect stop sequences.
  select
    count(distinct order_id),
    count(distinct stop_sequence),
    min(stop_sequence),
    max(stop_sequence),
    count(*) filter (
      where order_id is null
         or stop_sequence is null
         or estimated_arrival is null
    )
  into
    v_unique_orders,
    v_unique_sequences,
    v_min_sequence,
    v_max_sequence,
    v_invalid
  from jsonb_to_recordset(p_stops) as s(
    order_id uuid,
    stop_sequence integer,
    estimated_arrival timestamptz
  );

  if v_invalid > 0
     or v_unique_orders <> v_count
     or v_unique_sequences <> v_count
     or v_min_sequence <> 1
     or v_max_sequence <> v_count then
    raise exception 'Invalid or duplicate delivery stops';
  end if;

  -- Make sure the route has valid coordinates before saving it.
  if jsonb_typeof(p_geometry) is distinct from 'object'
     or p_geometry->>'type' is distinct from 'LineString'
     or jsonb_typeof(p_geometry->'coordinates')
        is distinct from 'array' then
    raise exception 'Invalid route geometry';
  end if;

  v_coordinates := p_geometry->'coordinates';

  if jsonb_array_length(v_coordinates) < 2 then
    raise exception 'Route geometry is too short';
  end if;

  for v_point in
    select value from jsonb_array_elements(v_coordinates)
  loop
    if jsonb_typeof(v_point) is distinct from 'array' then
      raise exception 'Invalid coordinate';
    end if;

    if jsonb_array_length(v_point) <> 2 then
      raise exception 'Invalid coordinate length';
    end if;

    if jsonb_typeof(v_point->0) is distinct from 'number'
       or jsonb_typeof(v_point->1) is distinct from 'number' then
      raise exception 'Invalid coordinate values';
    end if;

    if abs((v_point->>0)::numeric) > 180
       or abs((v_point->>1)::numeric) > 90 then
      raise exception 'Coordinates outside valid range';
    end if;
  end loop;

  -- Lock assigned orders and confirm the count matches the trip.
  perform 1
    from public.orders
   where trip_id = p_trip_id
   order by id
   for update;

  select count(*)
    into v_assigned_count
    from public.orders
   where trip_id = p_trip_id;

  if v_assigned_count <> v_count then
    raise exception 'Trip order count does not match';
  end if;

  if exists (
    select 1 from public.delivery_stops
    where trip_id = p_trip_id
  ) then
    raise exception 'Trip already has delivery stops';
  end if;

  -- Use locations stored in the database rather than coordinates from the request.
  insert into public.delivery_stops (
    trip_id,
    order_id,
    stop_sequence,
    location,
    estimated_arrival
  )
  select
    p_trip_id,
    s.order_id,
    s.stop_sequence,
    o.location,
    s.estimated_arrival
  from jsonb_to_recordset(p_stops) as s(
    order_id uuid,
    stop_sequence integer,
    estimated_arrival timestamptz
  )
  join public.orders o
    on o.id = s.order_id
   and o.trip_id = p_trip_id;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_count then
    raise exception 'Unable to save all delivery stops';
  end if;

  -- Mark the trip as routed only after every delivery stop is saved.
  update public.trips
     set route_geometry = p_geometry,
         status = 'ROUTED'
   where id = p_trip_id;
end;
$$;

revoke execute on function
  public.save_optimized_trip_route(uuid, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.save_optimized_trip_route(uuid, jsonb, jsonb)
  to service_role;
