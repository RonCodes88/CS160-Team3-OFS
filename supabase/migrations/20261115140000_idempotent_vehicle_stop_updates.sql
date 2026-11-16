-- Preserve successful robot acknowledgements across retries and vehicle release.
create or replace function public.vehicle_update_delivery_stop(
  p_vehicle_user_id uuid,
  p_stop_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_trip public.trips%rowtype;
  v_stop public.delivery_stops%rowtype;
  v_updated integer;
  v_trip_completed boolean := false;
begin
  if p_status is null or p_status not in ('ARRIVED', 'DELIVERED') then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_TRANSITION');
  end if;

  -- Lock the vehicle to prevent overlapping updates from the same robot.
  select v.*
    into v_vehicle
    from public.vehicles v
    join public.users u on u.id = v.user_id
   where v.user_id = p_vehicle_user_id
     and u.role = 'VEHICLE'
    for update of v;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  -- A final delivery releases current_trip_id. Authorize a repeated success
  -- through the immutable history written by this same vehicle user, so another
  -- robot cannot probe or replay a completed delivery it never performed.
  if p_status = 'DELIVERED' then
    select s.* into v_stop
      from public.delivery_stops s
      join public.trips t on t.id = s.trip_id
     where s.id = p_stop_id and s.status = 'DELIVERED'
       and t.status in ('OUT_FOR_DELIVERY', 'COMPLETED')
       and exists (
         select 1 from public.order_status_history h
          where h.order_id = s.order_id and h.status = 'DELIVERED'
            and h.changed_by = p_vehicle_user_id
       );
    if found then
      return jsonb_build_object(
        'ok', true,
        'stop', jsonb_build_object('id', v_stop.id, 'status', 'DELIVERED'),
        'tripCompleted', exists (
          select 1 from public.trips where id = v_stop.trip_id and status = 'COMPLETED'
        )
      );
    end if;
  end if;

  if v_vehicle.current_trip_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  select *
    into v_trip
    from public.trips
   where id = v_vehicle.current_trip_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  -- A vehicle can update only stops belonging to its assigned trip.
  select *
    into v_stop
    from public.delivery_stops
   where id = p_stop_id
     and trip_id = v_trip.id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if v_trip.status <> 'OUT_FOR_DELIVERY' then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_TRANSITION');
  end if;

  if v_stop.status = p_status then
    return jsonb_build_object(
      'ok', true,
      'stop', jsonb_build_object('id', v_stop.id, 'status', p_status),
      'tripCompleted', false
    );
  end if;

  if p_status = 'ARRIVED' then
    if v_stop.status not in ('PENDING', 'EN_ROUTE', 'DELAYED') then
      return jsonb_build_object('ok', false, 'reason', 'INVALID_TRANSITION');
    end if;

    update public.delivery_stops
       set status = 'ARRIVED',
           arrived_at = now()
     where id = v_stop.id;
  else
    if v_stop.status <> 'ARRIVED' then
      return jsonb_build_object('ok', false, 'reason', 'INVALID_TRANSITION');
    end if;

    update public.orders
       set status = 'DELIVERED',
           updated_at = now()
     where id = v_stop.order_id
       and trip_id = v_trip.id
       and status = 'OUT_FOR_DELIVERY';

    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
      raise exception 'Order is not ready for delivery';
    end if;

    insert into public.order_status_history (
      order_id, status, changed_by
    )
    values (v_stop.order_id, 'DELIVERED', p_vehicle_user_id);

    update public.delivery_stops
       set status = 'DELIVERED',
           completed_at = now()
     where id = v_stop.id;

    if not exists (
      select 1
        from public.delivery_stops
       where trip_id = v_trip.id
         and status <> 'DELIVERED'
    ) then
      update public.trips
         set status = 'COMPLETED',
             completed_at = now()
       where id = v_trip.id;

      -- Release the vehicle after its final delivery.
      update public.vehicles
         set current_trip_id = null,
             status = case
               when status = 'DELIVERING' then 'AVAILABLE'
               else status
             end
       where id = v_vehicle.id;

      v_trip_completed := true;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'stop', jsonb_build_object('id', v_stop.id, 'status', p_status),
    'tripCompleted', v_trip_completed
  );
end;
$$;

revoke execute on function public.vehicle_update_delivery_stop(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.vehicle_update_delivery_stop(uuid, uuid, text)
  to service_role;
