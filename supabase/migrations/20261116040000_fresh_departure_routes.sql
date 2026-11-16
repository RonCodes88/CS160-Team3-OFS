-- Existing routes deliberately remain unstamped: their traffic predictions may
-- already be stale. New route saves and new ROUTED fixtures are timestamped.
alter table public.trips add column route_planned_at timestamptz;

create function public.enforce_fresh_trip_departure()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_departure timestamptz;
  v_wait interval;
begin
  if new.status = 'ROUTED' then
    if tg_op = 'INSERT' then
      new.route_planned_at := clock_timestamp();
    elsif old.status <> 'ROUTED' or new.route_geometry is distinct from old.route_geometry then
      new.route_planned_at := clock_timestamp();
    end if;
  elsif new.status = 'PLANNED' and new.route_geometry is null then
    new.route_planned_at := null;
  end if;

  if tg_op = 'UPDATE' and old.status = 'ROUTED' and new.status = 'OUT_FOR_DELIVERY' then
    -- Use wall-clock time, not transaction-start now(), so a worker waiting on
    -- another transaction cannot depart using expired traffic predictions.
    v_departure := clock_timestamp();
    if old.route_planned_at is null or not isfinite(old.route_planned_at)
       or old.route_planned_at > v_departure
       or old.route_planned_at < v_departure - interval '60 seconds' then
      raise exception 'Trip requires a fresh traffic route before departure';
    end if;
    v_wait := v_departure - old.route_planned_at;
    -- Preserve travel-time offsets through the bounded wait between route save
    -- and departure. Clamp the first stop after provider processing latency.
    update public.delivery_stops
       set estimated_arrival = greatest(estimated_arrival + v_wait, v_departure)
     where trip_id = new.id;
    new.dispatched_at := v_departure;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_fresh_trip_departure() from public, anon, authenticated;
create trigger trips_fresh_departure
  before insert or update of status, route_geometry on public.trips
  for each row execute function public.enforce_fresh_trip_departure();

-- Do not repeatedly call Mapbox while every robot is unavailable. A stale plan
-- is reset only when a robot could depart, and only before any stop is visited.
create function public.delivery_prepare_departure_route(p_trip_id uuid, p_vehicle_id uuid default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_now timestamptz;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip does not exist'; end if;
  if v_trip.status <> 'ROUTED' then return 'WAIT'; end if;
  if not exists (
    select 1 from public.vehicles v join public.users u on u.id = v.user_id
     where v.status = 'AVAILABLE' and v.current_trip_id is null
       and u.role = 'VEHICLE' and u.status = 'ACTIVE'
       and (p_vehicle_id is null or v.id = p_vehicle_id)
  ) then return 'WAIT'; end if;

  v_now := clock_timestamp();
  if v_trip.route_planned_at is not null and isfinite(v_trip.route_planned_at)
     and v_trip.route_planned_at <= v_now
     and v_trip.route_planned_at >= v_now - interval '60 seconds' then
    return 'READY';
  end if;

  if (select count(*) from public.delivery_stops where trip_id = p_trip_id) <> v_trip.order_count
     or exists (select 1 from public.delivery_stops where trip_id = p_trip_id and status <> 'PENDING') then
    raise exception 'Only unvisited routed trips can refresh traffic';
  end if;
  -- No vehicle row is locked here. The dispatch transaction keeps its existing
  -- vehicle -> trip -> order lock order and rechecks availability and freshness.
  delete from public.delivery_stops where trip_id = p_trip_id;
  update public.trips set status = 'PLANNED', route_geometry = null, route_planned_at = null where id = p_trip_id;
  return 'REPLAN';
end;
$$;
revoke execute on function public.delivery_prepare_departure_route(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delivery_prepare_departure_route(uuid, uuid) to service_role;
