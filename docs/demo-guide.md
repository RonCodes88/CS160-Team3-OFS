# OFS presentation notes

OFS lets customers buy groceries online. Employees manage stock, managers manage products, and a background worker groups paid orders into robot-sized trips.

## Explain the architecture in 30 seconds

OFS has three main parts. Customers use the storefront to shop and pay. Store employees and managers use the dashboard to keep stock and products up to date. Once an order is paid, the delivery engine groups it with nearby orders, plans a route, and assigns a simulated robot.

Stripe handles test payments. Mapbox provides address and road-route information. All three parts share the same order and inventory information, so the store and customer see consistent availability and purchase totals.

Use the [README component diagram](../README.md#architecture) during this explanation. For technical questions, Next.js hosts the pages and API, PostgreSQL on Supabase stores data, and separate workers coordinate delivery and payment recovery. The modules in `src/lib` are service boundaries inside one application. Stock is stored in `products.stock_quantity`.

## Explain the core rules

| Rule | How the code represents it | Code to show |
| --- | --- | --- |
| Money | Integer cents. `$10 = 1000`. | `src/lib/cart/pricing.ts` |
| Weight | Integer hundredths of a pound. `20 lb = 2000`. | `src/lib/cart/pricing.ts` |
| Delivery fee | Below 20 lb is free. At 20 lb or more, add $10. | `calculateDeliveryFee` |
| Fee warning | Show a warning from 18 lb up to, but excluding, 20 lb. | `isNearFeeThreshold` |
| Cart limit | Reject additions above 200 lb. Permit reductions if a manager's weight edit made an existing cart overweight. | `20261115120000_cart_mutation_hardening.sql` |
| Robot capacity | At most 10 orders and 200 lb per trip. | `src/lib/delivery/batching.ts` |
| Departure eligibility | Check each minute. A full trip or an oldest order waiting 20 minutes is eligible for routing. | `src/lib/delivery/dispatch.ts` |

## Explain checkout in one minute

1. Cart updates send product IDs and quantities. Checkout sends a saved address ID and displayed totals. The server reloads the cart, prices, weights, stock, and address ownership.
2. Preview calculates the total without charging. The displayed tax is a simplified 5% demo policy.
3. Payment preparation saves an attempt with an idempotency key. Retrying the same request reuses the attempt.
4. Stripe collects card information and authorizes payment. OFS never stores card numbers, CVV, or expiry.
5. Browser confirmation and signed Stripe webhooks run the same finalization workflow. It revalidates the quote and captures payment before creating the order.
6. PostgreSQL locks the payment, cart, address, and product rows. One transaction creates order snapshots, subtracts stock, checks out the cart, and records status history.
7. A definite rejection after capture enters refund recovery. An uncertain database outcome retries reconciliation so a committed order is not refunded by mistake.

Show `src/lib/payments/finalize.ts` for the recovery workflow and `supabase/migrations/20261021140000_payment_finalization.sql` for the order transaction.

## Explain delivery honestly

The oldest paid order starts a batch. Nearby orders fill remaining capacity. Nearest-neighbor ordering selects a stop sequence, then Mapbox supplies the road route and travel times. Routing failures mark the trip `ROUTE_FAILED` and put orders back in the queue without changing their original paid times.

Show `src/lib/delivery/batching.ts`, `src/lib/routing/optimization.ts`, and `scripts/delivery-worker.ts`.

The worker assigns an AVAILABLE vehicle and changes the trip and orders to OUT_FOR_DELIVERY in one transaction. Mapbox uses the traffic profile and the actual departure time for road routes and ETAs. The simulated robot signs in over HTTP and reports its assigned deliveries.

Stop ordering remains a geographic heuristic rather than a proof of the globally shortest route. See [worker and simulator commands](run-workers.md).

## Explain access and staff tools

The session cookie holds a random token. PostgreSQL stores its hash. API handlers derive customer identity and role from that session. Customers cannot submit another user's ID to gain access. Employees and managers can query stock and update quantities. Managers can create, edit, and retire products. Staff changes record old and new values in `audit_log`.

Show `src/lib/auth/requireRole.ts`, `src/app/api/staff/inventory/route.ts`, and `src/components/staff/StaffDashboard.tsx`.

## Run a five-minute demonstration

1. Search and filter products in **Shop**. Open one product.
2. Add items and change quantities. Show cart weight and the fee threshold.
3. Use a local test customer to save an eligible address and review checkout. Complete payment using Stripe test mode.
4. Show the confirmation totals and order snapshot.
5. Sign in as an employee. Search inventory and update a quantity.
6. Sign in as a manager. Edit a product, inspect the audit log, and explain retirement.
7. Run `npm run delivery:worker -- --once` and `npm run robot:simulator` to show a paid order batched, routed, sent out, and delivered. The tracking API is implemented; the live map page remains a placeholder.

## Run the whole flow from the website

For a demo where someone else clicks through as a customer, let the website run the background jobs itself. Add these lines to `.env.local` and restart the site:

```text
OFS_IN_APP_WORKERS=true
OFS_IN_APP_ROBOT=true
OFS_ROBOT_EMAIL=<a VEHICLE account>
OFS_ROBOT_PASSWORD=<its password>
OFS_DELIVERY_WAIT_MINUTES=1
```

After payment, the order joins a trip within about two minutes. The simulated robot then drives along the road route on the tracking map, waits 30 seconds at the door, and marks the order delivered. If email is configured (see [run-workers.md](run-workers.md#configure-email-delivery)), the customer receives the confirmation, departure, arrival, and delivery emails.

`OFS_DELIVERY_WAIT_MINUTES=1` shortens the 20-minute wait so one order leaves quickly. Explain that the production rule is 20 minutes. Run the jobs in only one copy of the site per database, and do not also start the worker scripts.

## Explain the testing in 30 seconds

| Layer | What it proves | Command |
| --- | --- | --- |
| Backend unit tests | Fee, weight, batching, validation, and payment rules in isolation. Stripe and Mapbox are mocked. | `npm test` |
| Database tests | SQL transactions, locks, and constraints against a real local PostgreSQL. | `npm run test:db`, `npx supabase test db` |
| API integration tests | Real HTTP requests to the running app: roles (401/403/404), cart boundaries at 18.00, 19.99, 20.00, 199.99, 200.00, and above 200 lb, stock, audit log, checkout preview. | `npm run test:e2e:live` |
| End-to-end customer tests | A real browser: register, search, add to cart, fee rules, two tabs, log out in another tab, staff stock update, and a Stripe test-card payment that creates one order. | `npm run test:e2e:live` |
| Browser failure tests | Network drops, expired sessions, and rejected changes, using fixed API responses. | `npm run test:e2e` |

The live suite only runs against a local database. It refuses any other address.

Use a dedicated local test database for rehearsal. Never demonstrate a real charge. See [the black-box checklist](black-box-checklist.md) for acceptance checks.

See [architecture and code ownership](architecture.md), [API flows](api-flows.md), and [demo rehearsal and coverage limits](testing.md) for more detail.
