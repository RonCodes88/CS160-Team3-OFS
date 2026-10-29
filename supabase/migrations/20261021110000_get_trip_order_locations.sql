-- Get delivery coordinates from stored orders, not from client input.
create function public.get_trip_order_locations(
  p_trip_id uuid
)
returns table (
  order_id uuid,
  lat double precision,
  lng double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    o.id as order_id,
    extensions.ST_Y(
      o.location::extensions.geometry
    ) as lat,
    extensions.ST_X(
      o.location::extensions.geometry
    ) as lng
  from public.orders as o
  where o.trip_id = p_trip_id
  order by o.id;
$$;

-- Only the backend service role should be able to call this function.
revoke execute
on function public.get_trip_order_locations(uuid)
from public, anon, authenticated;

grant execute
on function public.get_trip_order_locations(uuid)
to service_role;
