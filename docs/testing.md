# Demo rehearsal and testing

The automated suites cover the storefront and staff demo well: real registration, shopping, stock and fee rules, access checks, cart persistence, staff edits, audit records, and a Stripe test-card purchase. They cannot guarantee that hosted providers, network access, or background workers will be available during class.

## Run the checks

Use Node 24 or newer, installed dependencies, Docker Desktop, and a dedicated local Supabase instance. Do not point tests at hosted demo data.

```bash
npm ci
npx supabase start
npx supabase migration up --local
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run test:e2e:live
```

For the database suites in `npm test`, configure `SUPABASE_TEST_URL` and `SUPABASE_TEST_SECRET_KEY` in `.env.test.local` using local Supabase status. Database suites skip when these are absent. The live suite discovers local credentials itself and refuses non-local database hosts. It creates customers and products, changes local stock and carts, and retires its created products after testing. Use a test instance rather than data needed for a presentation.

The live Stripe test requires test-mode keys in `.env.local`. It skips when keys are absent. Check the test summary: a skipped payment test does not verify payment. Stripe Elements also requires internet access.

| Suite | Coverage | Limitation |
| --- | --- | --- |
| `npm test` | Pure rules, services, components, handlers, and configured database integration tests | Unit provider responses are mocked |
| `npm run test:e2e` | Browser regressions for offline requests, expired sessions, failed stock updates, payment recovery UI, multiple tabs, mobile navigation | Uses fixed provider responses and a component harness |
| `npm run test:e2e:live` | Real HTTP API contracts and browser customer and staff journeys against local Supabase | Stripe payment requires keys and network; no complete worker-to-robot delivery journey |
| `npx supabase test db` | SQL rollback and inventory transaction rules | Separate from the browser suite |
| `python3 scripts/test-cart-concurrency.py` | Cart edits racing checkout | Requires local Supabase |

The live mobile cart test checks 19.99, 20.00, 199.99, and 200.00 lb, rejects an addition over 200 lb, and verifies the saved cart after reload. The wider API suite also covers the warning threshold, invalid inputs, ownership, stock conflicts, and checkout quote mismatch.

Browser regressions use port 3001 and `.next-browser`, with a harness on port 3002. Live tests use port 3004 and `.next-e2e`. Regular development uses `.next`. These folders prevent dev-server lock collisions. Generated output is excluded from Git and ESLint. Run typechecking after browser servers finish because Next.js generates shared route declarations and can update `tsconfig.json`.

## Rehearse the presentation

1. Start the same app configuration and browser you will use in class. Confirm database health and active catalog products.
2. Sign in with a local customer, check the saved delivery address, and rehearse the fee threshold and checkout.
3. Complete a Stripe test payment using `4242 4242 4242 4242`, a future expiry, and any valid test CVC. Confirm the order total, stock decrement, and emptied cart.
4. Sign in as an employee and change a stock quantity. Sign in as a manager and show the resulting audit entry.
5. If presenting delivery, start the delivery and recovery workers and the simulated robot using [the worker guide](run-workers.md). A partial batch normally waits 20 minutes. Rehearse the configured wait time before class.
6. Check Mapbox and Stripe network access from the presentation machine. Keep [the architecture diagram](../README.md#architecture) and [API flow](api-flows.md) ready for explanation.

## What remains outside browser proof

The current browser suites do not drive a complete paid-order-to-delivered sequence through the delivery worker, real Mapbox routing, and simulated robot. Database and service tests cover those modules separately. Rehearse that sequence manually if it is part of the demo. The confirmation page shows order details; the tracking API is implemented separately from a live map UI.

A successful purchase does not prove email delivery. The local payment run completed with `NOTIFICATIONS_NOT_CONFIGURED`; configure the notification sender separately if email is part of the presentation.

The browser runs use Chromium. A mobile viewport exercises responsive layout but is not a real phone or WebKit test. External provider outages, webhook forwarding configuration, and worker process supervision still need a rehearsal check.

On failure, inspect `test-results/`. Playwright retains traces for failed tests. Open a trace with `npx playwright show-trace <path-to-trace.zip>`. Fix the underlying failure before treating a retry as evidence of stability.
