#!/bin/sh
# Uses a NEW database inside a local Supabase test container, never the app DB.
set -eu
container="${OFS_MIGRATION_TEST_CONTAINER:-supabase_db_CS160-Team3-OFS}"
export OFS_DATABASE_URL="${OFS_MIGRATION_TEST_DB_URL:?Set a local URL ending in /ofs_install_check?sslmode=disable}"
case "$OFS_DATABASE_URL" in
  postgresql://postgres:postgres@127.0.0.1:*/ofs_install_check\?sslmode=disable) ;;
  postgresql://postgres:postgres@host.docker.internal:*/ofs_install_check\?sslmode=disable) ;;
  *) echo 'Refusing to test migrations outside the dedicated local ofs_install_check database.' >&2; exit 1 ;;
esac
docker exec "$container" createdb -U postgres --template=template0 ofs_install_check
trap 'docker exec "$container" dropdb -U postgres ofs_install_check' EXIT

# Supabase creates this infrastructure schema before application migrations.
docker exec "$container" psql -U postgres -d ofs_install_check -v ON_ERROR_STOP=1 -c 'create schema extensions'

node scripts/db-migrate.mjs
expected="$(find supabase/migrations -name '*.sql' | wc -l | tr -d ' ')"
actual="$(docker exec "$container" psql -U postgres -d ofs_install_check -Atc 'select count(*) from supabase_migrations.schema_migrations')"
test "$actual" = "$expected"
docker exec "$container" psql -U postgres -d ofs_install_check -v ON_ERROR_STOP=1 -c "insert into public.categories (name, slug) values ('Preserve after restart', 'install-check')"

# A restart must skip every migration and preserve existing application data.
node scripts/db-migrate.mjs
actual="$(docker exec "$container" psql -U postgres -d ofs_install_check -Atc 'select count(*) from supabase_migrations.schema_migrations')"
test "$actual" = "$expected"
test "$(docker exec "$container" psql -U postgres -d ofs_install_check -Atc "select count(*) from public.categories where slug = 'install-check'")" = 1
echo 'Fresh installation and repeated migration checks passed.'
