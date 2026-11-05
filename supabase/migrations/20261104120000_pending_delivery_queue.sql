-- The orders table is the queue: a committed paid order becomes visible without
-- a second enqueue write. Its primary key prevents duplicate entries.
create function public.order_read_pending_delivery_queue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- One JSON result avoids PostgREST's row cap silently truncating the queue.
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'paid_at', o.paid_at,
    'total_weight', o.total_weight,
    'latitude', extensions.st_y(o.location::extensions.geometry),
    'longitude', extensions.st_x(o.location::extensions.geometry)
  ) order by o.paid_at, o.id), '[]'::jsonb)
  from public.orders o
  where o.status = 'PAID' and o.paid_at is not null and o.trip_id is null;
$$;

revoke execute on function public.order_read_pending_delivery_queue() from public, anon, authenticated;
grant execute on function public.order_read_pending_delivery_queue() to service_role;
