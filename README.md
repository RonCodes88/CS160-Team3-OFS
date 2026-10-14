# CS160 Team 3 — OFS

Next.js 16 (TypeScript, Tailwind) + Supabase. **Everything runs in Docker**, so you don't need Node installed.

## First-time setup

**1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)** and open it.

**2. Clone the repo and create your env file:**

```bash
git clone https://github.com/RonCodes88/CS160-Team3-OFS.git
cd CS160-Team3-OFS
cp .env.example .env.local
```

**3. Fill in `.env.local`** with the Supabase URL and publishable key (ask the team, or copy them from the Supabase dashboard → Project Settings → API Keys).

**4. Start the app:**

```bash
docker compose up --build
```

Open **http://localhost:3000**. The footer should say `Supabase: Connected · PostGIS <version>` (see [Database](#database)).

## Everyday use

| What                  | Command                                |
| --------------------- | -------------------------------------- |
| Start the app         | `docker compose up`                    |
| Stop the app          | `Ctrl+C`, then `docker compose down`   |
| Lint                  | `docker compose exec web npm run lint` |
| Typecheck             | `docker compose exec web npm run typecheck` |
| Unit tests            | `docker compose exec web npm test`     |
| Add a package         | `docker compose exec web npm install <package>` |
| Supabase CLI          | `docker compose exec web npx supabase <command>` |

Code changes reload automatically in the browser. Commands with `exec` need the app running (`docker compose up`) in another terminal.

**After pulling changes that touch `package.json`**, rebuild once:

```bash
docker compose up --build --renew-anon-volumes
```

## Making changes

`main` is protected, so you can't push to it directly.

```bash
git checkout -b my-feature
# ...make changes, then:
git add .
git commit -m "Describe your change"
git push -u origin my-feature
```

Then open a Pull Request on GitHub. CI (lint, typecheck, unit tests, build, Docker build) runs on every PR and must pass before you can merge.

## Where things are

| Path                         | What                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `src/app/`                   | Pages and layouts                                       |
| `src/lib/supabase/client.ts` | Supabase client for Client Components (`"use client"`)  |
| `src/lib/supabase/server.ts` | Supabase client for Server Components, Actions, Routes  |
| `src/proxy.ts`               | Refreshes the Supabase login session on each request    |
| `supabase/migrations/`       | Database schema changes (`npx supabase migration new <name>`) |

## Database

PostgreSQL on Supabase, with **PostGIS** for delivery locations. PostGIS is enabled by a migration in the `extensions` schema, and `extensions` is on the search path, so `geography(Point, 4326)` and `ST_*` functions work without a prefix. Run the commands below inside Docker (`docker compose exec web npx supabase ...`) or with Node installed.

- **Team access:** the project owner invites teammates from the Supabase dashboard → Organization settings → Team.
- **Health check:** the footer shows `Supabase: Connected · PostGIS <version>` when the server can run a query with `SUPABASE_SECRET_KEY` (it calls `public.db_health()`). If it says `db_health() is missing`, the hosted database is behind on migrations.
- **Apply migrations to the hosted project** (one person, after a migration PR merges):
  ```bash
  npx supabase login
  npx supabase link --project-ref <project-ref>   # from the dashboard URL
  npx supabase db push
  ```
- **Local database for DB tests:** `npx supabase start` runs Postgres with every migration applied. `npx supabase db reset` re-applies them from scratch. Copy the API URL and secret key from `npx supabase status` into `.env.test.local` as `SUPABASE_TEST_URL` and `SUPABASE_TEST_SECRET_KEY`. Then `npm test` also runs the `*.db.test.ts` files.
- **Schema changes:** add a new migration (`npx supabase migration new <name>`). Never edit one that's already applied.

## Troubleshooting

- **`Supabase: Not configured`**: `.env.local` is missing or empty. Fill it in, then restart with `docker compose up`.
- **Port 3000 already in use**: stop whatever else is running on 3000, or change `"3000:3000"` to `"3001:3000"` in `compose.yaml` and use http://localhost:3001.
- **Something is weird after pulling**: reset the container with `docker compose down` and then `docker compose up --build --renew-anon-volumes`.
