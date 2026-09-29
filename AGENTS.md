<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project
OFS (On Demand Food Delivery Service): an online grocery store for one store in Downtown San Jose, delivered by a self-driving robot. Three parts: customer storefront, delivery engine, staff dashboard. Team 3 class project. The full LLD and test plan are the source of truth; this file holds the rules that must never break.

Out of scope: robot hardware (use the simulated robot client), native mobile apps, internals of Stripe/Mapbox/email provider.

## Stack
- Frontend: Next.js + TypeScript (responsive web)
- Backend: Node.js + TypeScript
- Database: PostgreSQL on Supabase with PostGIS
- Payments: Stripe (test mode only)
- Maps: Mapbox (geocoding and routing)
- Tests: Jest/Vitest (unit, component), Postman (API), Playwright or Cypress (E2E)
- CI: GitHub Actions runs all tests on every PR

## Commands
<!-- Update once package.json scripts exist -->
- Install: `npm install`
- Dev: `npm run dev`
- Test: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`

## Core business rules (never violate)
- Money is integer cents. Never use floats for money.
- Weight is integer hundredths of a pound (20.00 lbs = 2000). Never use floats for weight.
- Delivery fee: weight < 2000 is free; weight >= 2000 costs 1000 cents ($10).
- Show fee warning when 1800 <= weight < 2000.
- Max cart weight is 20000 (200.00 lbs). Reject the change, do not split the order.
- Robot trip: max 10 orders AND max 20000 total weight.
- Batching runs every minute. The oldest PAID order starts each trip, nearby orders fill it. Dispatch when full or when the oldest order has waited 20 minutes.
- If routing fails, mark trip ROUTE_FAILED and return its orders to the queue in their original order.
- The server is the source of truth for prices, weights, stock, fees, and totals. Never trust values, user IDs, or roles sent by the client.
- Never store card numbers, CVV, or expiry. Store only the Stripe provider ID and status.
- Products are retired (is_active = false), never deleted.
- Boundary cases to always test: 19.99, 20.00, 199.99, 200.00, and above 200 lbs.

## Status values
Order transitions (anything else is rejected; repeating the current status is a no-op):
- PAID -> PREPARING, BATCHED, CANCELED
- PREPARING -> BATCHED, CANCELED
- BATCHED -> OUT_FOR_DELIVERY, CANCELED
- OUT_FOR_DELIVERY -> DELIVERED

Every order status change writes a row to order_status_history.

- Trip: PLANNED, ROUTED, OUT_FOR_DELIVERY, COMPLETED, ROUTE_FAILED
- Delivery stop: PENDING, EN_ROUTE, ARRIVED, DELIVERED, DELAYED, FAILED
- Vehicle: AVAILABLE, DELIVERING, OFFLINE
- Payment: PENDING, AUTHORIZED, CAPTURED, FAILED, VOIDED, REFUNDED
- Notification: PENDING, SENT, FAILED

## Services
Each service owns its own tables. Other services go through its API, not its tables.
- Auth and Identity: users, addresses, auth_sessions
- Catalog (read-only public API): categories, products
- Cart and Pricing: carts, cart_items
- Checkout and Payment: payment_attempts
- Order: orders, order_items, order_status_history
- Delivery Batching: trips (background job, no public endpoints)
- Route Optimization: delivery_stops
- Vehicle Tracking: vehicles
- Inventory and Admin: inventory, audit_log
- Notification: notifications
- API Gateway: no tables; routing and access checks only, no business logic

## Checkout flow
1. `POST /api/checkout/preview` revalidates cart, address, stock, and totals. No charge.
2. `POST /api/checkout/payment-intent` requires an idempotency key. Same key returns the same attempt.
3. Browser confirm and Stripe webhook both call the same idempotent finalize logic.
4. createOrder runs in ONE transaction: lock payment, cart, address, and inventory rows; recalculate totals; check stock; create order and order_items with snapshots; decrement inventory; link payment; mark cart CHECKED_OUT; add history row.
5. If the transaction fails, void or refund the Stripe authorization.
6. Webhooks must pass Stripe signature verification.

## Auth and access
- Roles: CUSTOMER, EMPLOYEE, MANAGER, VEHICLE. Only customers self-register.
- Store password hashes and session token hashes only. Never return either.
- Registration and login are rate-limited.
- Gateway returns 404 for unmatched routes, 401 for invalid sessions, 403 for wrong role.
- `/api/auth/register`, `/api/auth/login`, `/api/categories`, `/api/products/*`: public
- `/api/cart/*`, `/api/checkout/*`, `/api/orders/*`, `/api/addresses/*`, `/api/tracking/*`: CUSTOMER
- `/api/staff/*`: EMPLOYEE or MANAGER
- `/api/admin/*`: MANAGER
- `/api/vehicle/*`: VEHICLE
- `/api/internal/*`: authorized backend services only
- Services still check ownership (customers only see their own orders and addresses).
- Every staff inventory or product change writes to audit_log with old and new values.

## Database conventions
- UUID primary keys, TIMESTAMPTZ for times, snake_case names.
- Use CHECK constraints for limits as a safety net, but enforce rules in code first.
- One ACTIVE cart per customer and one default address per customer (partial unique indexes).
- Addresses are geocoded with Mapbox and rejected if outside the service radius.
- Orders snapshot product names, prices, weights, and delivery address at checkout.
- Schema changes go in new migrations. Never edit an applied migration.

## Testing
- Test-driven: write expected behavior first. A task is done only when its tests pass.
- Mock Stripe and Mapbox in unit tests. Use a simulated robot client.
- Use the separate test database. Never touch demo data.
- Coverage targets: fee and capacity rules 100%, checkout 90%, other backend 80%, frontend 70%.
- Critical defects (wrong charges, oversold stock, unauthorized access, overloaded trips) block merging.

## Git workflow
<!-- Update with the team's agreed branch naming -->
- Branch from main: `feature/<short-name>` or `fix/<short-name>`
- Open a PR for every change. CI must be green before merge.
- Keep PRs small and focused on one backlog task.

## Rules for coding agents
- Check the LLD section for a service before implementing it.
- Keep changes scoped to the task. Do not refactor unrelated code.
- Ask before adding new dependencies.
- Never commit secrets. Only update `.env.example` (Stripe, Mapbox, Supabase keys).
- If the spec is unclear or contradicts itself, ask instead of guessing.
