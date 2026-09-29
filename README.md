# CS160 Team 3 — OFS

Next.js 16 (App Router, TypeScript, Tailwind v4) + Supabase.

## Quick start (Docker, recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env.local   # then fill in the Supabase URL + publishable key
docker compose up --build    # http://localhost:3000
```

Code changes hot-reload. Stop with `Ctrl+C` or `docker compose down`.
After changing `package.json`, rebuild with `docker compose up --build --renew-anon-volumes`.

## Without Docker

Requires Node 24 (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Supabase

- **Shared cloud project (default):** get the URL and publishable key from the Supabase dashboard → Project Settings → API Keys, and put them in `.env.local`.
- **Local Supabase (optional):** `npx supabase start` runs a full local stack in Docker and prints a local URL + publishable key to put in `.env.local`. Run the app with `npm run dev` in this mode; from inside the app container, `localhost` points at the container, not your machine.
- Schema changes live in `supabase/migrations/` (`npx supabase migration new <name>`).

Clients live in `src/lib/supabase/`:

| File        | Use in                                               |
| ----------- | ---------------------------------------------------- |
| `client.ts` | Client Components (`"use client"`)                   |
| `server.ts` | Server Components, Server Actions, Route Handlers    |
| `proxy.ts`  | Used by `src/proxy.ts` to refresh the auth session   |

## Scripts

| Command             | What it does          |
| ------------------- | --------------------- |
| `npm run dev`       | Dev server            |
| `npm run lint`      | ESLint                |
| `npm run typecheck` | TypeScript check      |
| `npm run build`     | Production build      |

## Workflow

`main` is protected: open a PR from a feature branch. CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, and a Docker build, and it must pass before merging.

## Production image

```bash
docker build --target runner -t ofs .
docker run -p 3000:3000 --env-file .env.local ofs
```

`NEXT_PUBLIC_*` variables are inlined into client code at build time, so a real deploy needs them available during `docker build`.
