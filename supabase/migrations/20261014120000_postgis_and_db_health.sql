-- PostGIS for delivery addresses, the service radius, and routing. It lives in
-- the extensions schema, never public, so spatial_ref_sys is not exposed
-- through the Data API. extensions is already on the API search_path
-- (supabase/config.toml), so geography(Point, 4326) and ST_* resolve without
-- a schema prefix.
create extension if not exists postgis with schema extensions;

-- Health check used by the app's footer badge (src/lib/db/health.ts). One
-- round trip proves the server can reach Postgres with its configured key
-- and that PostGIS is installed.
create function public.db_health()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'database', current_database(),
    'postgis', extensions.postgis_lib_version(),
    'checked_at', now()
  );
$$;

-- Server-only: callable with the secret key, not the publishable key.
revoke execute on function public.db_health() from public, anon, authenticated;
grant execute on function public.db_health() to service_role;
