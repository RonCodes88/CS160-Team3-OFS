# Run OFS from a GitHub checkout

Install and start Docker Desktop with Docker Compose support. The default setup runs the app locally and uses the hosted Supabase project configured in `.env.local`. Stripe and Mapbox still require internet access.

## Prepare the test environment

The team should prepare a dedicated Supabase test project, apply every repository migration, and provision test accounts and a catalog before handing it to testers. Do not use a database containing data you need to preserve. The local demo accounts in `supabase/seed.sql` are created by local Supabase setup; connecting to a hosted project does not create those accounts automatically.

Give trusted testers a completed `.env.local` through a password manager's secure sharing feature. Keep the file out of GitHub, issues, PRs, and screenshots. Include only credentials for the dedicated test environment:

- Supabase URL, publishable key, and server secret key for that project.
- Matching Stripe test secret and publishable keys.
- Stripe webhook signing secret for the listener or endpoint being tested.
- Mapbox server and public tokens. Allow `http://localhost:3000` on the public token.
- Store coordinates and delivery radius from `.env.example`.

The server secret grants privileged database access. Anyone running this backend locally can read it. Give backend credentials only to trusted testers, revoke them after testing, or provide a hosted test site when testers should not have database access. Supabase explains the privilege in its [API key guide](https://supabase.com/docs/guides/getting-started/api-keys).

Never send production keys. Keep `OFS_EMAIL_PROVIDER=disabled` unless email delivery is part of the test.

## Start the application

```sh
git clone https://github.com/RonCodes88/CS160-Team3-OFS.git
cd CS160-Team3-OFS
cp .env.example .env.local
```

Replace the placeholders in `.env.local` with the test credentials, then run:

```sh
docker compose up --build
```

Open http://localhost:3000. Check the footer's database connection, browse the catalog, and sign in using the accounts supplied by the team. A page loading alone does not prove the database or provider credentials work.

To run delivery and the robot with this same command, set:

```dotenv
OFS_IN_APP_WORKERS=true
OFS_IN_APP_ROBOT=true
OFS_ROBOT_BASE_URL=http://127.0.0.1:3000
OFS_ROBOT_EMAIL=<vehicle account in the test database>
OFS_ROBOT_PASSWORD=<vehicle account password>
```

The VEHICLE account must have an active AVAILABLE vehicle in the database. Use these flags on only one app instance per database. Keep separate worker processes stopped when these flags are enabled. The default batching wait is 20 minutes; a smaller positive `OFS_DELIVERY_WAIT_MINUTES` can speed up a supervised demo.

After editing `.env.local`, run `docker compose up --build` again. Compose recreates the container when its environment changes. `docker compose restart` alone retains the old environment.

## Verify checkout webhooks

Browser payment confirmation and Stripe webhooks both finalize payments. To test webhook delivery to localhost, install the Stripe CLI on the host, sign in to the same Stripe test account, and run:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy that listener's `whsec_` value to `STRIPE_WEBHOOK_SECRET` and recreate the app container. Each tester uses their own listener secret. A hosted endpoint's signing secret does not verify a local CLI listener's signatures.

## Check and stop the app

With the app running, use another terminal:

```sh
docker compose exec web npm run lint
docker compose exec web npm run typecheck
docker compose exec web npm test
```

Database integration suites skip unless a separate local test database is configured. Do not point `SUPABASE_TEST_*` at the shared hosted project. See [testing](testing.md) for database and browser tests.

Stop the app with Ctrl+C, then run:

```sh
docker compose down
```

## Connect to an existing local Supabase

This is optional and requires Node 24 on the host to run the repository's Supabase CLI. Run `npm ci` and `npx supabase start` on the host. Supabase applies the migrations and local seed. Run `npx supabase status` to obtain the local keys, then put those keys in `.env.local`.

For Docker Desktop, set `NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321` so the app container can reach Supabase on the host. Container loopback points at the app container itself. On Linux Docker Engine, configure a host gateway mapping for `host.docker.internal` before using this URL. Use the hosted setup above for a handoff requiring only Docker Desktop and one startup command.
