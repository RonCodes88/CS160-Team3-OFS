-- Read-only address-service helper for checkout. Identity comes from the
-- authenticated server session; public/anonymous callers cannot execute it.
create function public.customer_read_address_location(p_customer_id uuid, p_address_id uuid)
returns table (id uuid, customer_id uuid, latitude double precision, longitude double precision)
language sql stable
set search_path = ''
as $$
  select a.id, a.customer_id,
         extensions.st_y(a.location::extensions.geometry),
         extensions.st_x(a.location::extensions.geometry)
    from public.addresses a
    join public.users u on u.id = a.customer_id
   where a.customer_id = p_customer_id and a.id = p_address_id
     and u.role = 'CUSTOMER' and u.status = 'ACTIVE';
$$;

revoke execute on function public.customer_read_address_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_read_address_location(uuid, uuid) to service_role;
