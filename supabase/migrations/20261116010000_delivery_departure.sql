-- Persist assignment after completion, and depart only through one transaction.
alter table public.trips add column vehicle_id uuid references public.vehicles(id) on delete set null;
create unique index trips_one_active_trip_per_vehicle on public.trips(vehicle_id)
  where status = 'OUT_FOR_DELIVERY' and vehicle_id is not null;

create function public.delivery_dispatch_trip(p_trip_id uuid, p_vehicle_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_count integer;
  v_weight bigint;
  v_invalid integer;
begin
  select * into v_trip from public.trips where id = p_trip_id;
  if not found then raise exception 'Trip does not exist'; end if;
  if v_trip.status in ('OUT_FOR_DELIVERY', 'COMPLETED') then
    return v_trip.vehicle_id;
  end if;
  if v_trip.status <> 'ROUTED' then raise exception 'Only ROUTED trips can depart'; end if;

  -- Match vehicle stop updates: lock vehicle before trip, then assigned orders.
  -- SKIP LOCKED lets independent workers assign different available robots.
  if p_vehicle_id is null then
    select v.* into v_vehicle from public.vehicles v join public.users u on u.id = v.user_id
      where v.status = 'AVAILABLE' and v.current_trip_id is null
        and u.role = 'VEHICLE' and u.status = 'ACTIVE'
      order by v.id for update of v skip locked limit 1;
  else
    select v.* into v_vehicle from public.vehicles v join public.users u on u.id = v.user_id
      where v.id = p_vehicle_id and u.role = 'VEHICLE' and u.status = 'ACTIVE'
      for update of v;
  end if;
  if not found then return null; end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip does not exist'; end if;
  if v_trip.status in ('OUT_FOR_DELIVERY', 'COMPLETED') then return v_trip.vehicle_id; end if;
  if v_trip.status <> 'ROUTED' then raise exception 'Only ROUTED trips can depart'; end if;
  if v_vehicle.status <> 'AVAILABLE' or v_vehicle.current_trip_id is not null then return null; end if;

  perform 1 from public.orders where trip_id = p_trip_id order by id for update;
  select count(*), coalesce(sum(total_weight), 0), count(*) filter (where status <> 'BATCHED')
    into v_count, v_weight, v_invalid from public.orders where trip_id = p_trip_id;
  if v_count not between 1 and 10 or v_weight > 20000 or v_invalid <> 0
     or v_count <> v_trip.order_count or v_weight <> v_trip.total_weight
     or v_trip.route_geometry is null then
    raise exception 'Trip capacity or assigned orders are invalid';
  end if;
  if (select count(*) from public.delivery_stops where trip_id = p_trip_id) <> v_count
     or exists (
       select 1 from public.orders o where o.trip_id = p_trip_id and not exists (
         select 1 from public.delivery_stops s where s.trip_id = p_trip_id and s.order_id = o.id and s.status = 'PENDING'
       )
     ) then raise exception 'Trip delivery stops are invalid'; end if;

  update public.vehicles set status = 'DELIVERING', current_trip_id = p_trip_id where id = v_vehicle.id;
  update public.trips set status = 'OUT_FOR_DELIVERY', vehicle_id = v_vehicle.id, dispatched_at = now() where id = p_trip_id;
  update public.orders set status = 'OUT_FOR_DELIVERY', updated_at = now() where trip_id = p_trip_id;
  insert into public.order_status_history(order_id, status, notes)
    select id, 'OUT_FOR_DELIVERY', 'Dispatched by delivery worker' from public.orders where trip_id = p_trip_id;
  return v_vehicle.id;
end;
$$;
revoke execute on function public.delivery_dispatch_trip(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delivery_dispatch_trip(uuid, uuid) to service_role;
