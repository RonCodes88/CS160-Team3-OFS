# Stripe integration — Issue #19

## Implemented: prepare a payment

`POST /api/checkout/payment-intent` requires a CUSTOMER session, JSON
`{ addressId, expected }` (same totals as checkout preview), and an
`Idempotency-Key` header: 1–128 letters, digits, hyphens or underscores.
Use a random UUID per checkout attempt and retain it for retries.

The server reuses #18's validator and owning-service reads, checks current
stock/address/totals, then saves a payment attempt before calling Stripe. It
returns `{ attemptId, paymentIntentId, clientSecret, status }` with `no-store`.
The client secret is returned only while confirmation can proceed; it is never
saved in the database or logged. Identity and amounts never come directly from
client claims.

`createStripeClient` accepts only test secret keys. Server callers should pass
`STRIPE_SECRET_KEY`; never import this module into a client component.
`createAuthorizationIntent` takes a persisted payment-attempt UUID and freshly
validated total in integer cents. It creates a USD card PaymentIntent with
manual capture and a stable Stripe idempotency key. Creating an intent alone
does not authorize funds or create an order.

## Persistence and retries

Apply `20261021130000_payment_attempt_checkout.sql`. It adds an address reference,
request hash, and checkout snapshot (cart, items, prices, weights, totals, address
ID and coordinates). Legacy rows remain valid but cannot be resumed through the
new endpoint without those bindings. Full delivery-address text is still to be
snapshotted by order creation.

The two new RPCs are service-role-only. Reservation locks the owned active cart
and permits only one pending/authorized/captured attempt per cart through this
API. A second key returns `PAYMENT_IN_PROGRESS`; the same key reuses the saved
attempt. Keys are hashed and scoped to the session customer. Reusing a key with
different input returns `IDEMPOTENCY_CONFLICT`. A changed server snapshot returns
`CHECKOUT_CHANGED`, including item changes that leave aggregate totals unchanged.

Known provider IDs are retrieved rather than recreated. After an uncertain
creation failure, retries use the original attempt and Stripe idempotency key.
Unlinked attempts older than 23 hours require reconciliation because Stripe may
prune keys after 24 hours. Provider failures return a safe 503 and leave the
attempt pending; failed responses do not prove Stripe created nothing.

USD amounts below 50 cents or above 99,999,999 cents are rejected. Existing
checkout errors retain their 400/409/422 responses; missing payment or service-area
configuration returns 503. Unexpected errors return 500 without provider details.

## Remaining sequence

1. Add Stripe Elements to the checkout UI and confirm using the returned secret.
   Card details go directly to Stripe; OFS never receives them.
2. Add the customer confirmation endpoint and signature-verified Stripe webhook.
   Both must call the same idempotent finalizer, including duplicate events.
3. Connect the Order Service transaction: lock and revalidate payment/cart/address/
   inventory, create snapshots and history, decrement stock, link the payment,
   and mark the cart checked out. Define capture and recovery together with it.
4. Complete cancellation, failed/declined payment handling, void/refund compensation,
   and reconciliation of uncertain attempts. A changed/abandoned pending attempt
   currently blocks a new key until this lifecycle is implemented.
5. Run Stripe test-mode browser checks for success, decline, authentication,
   repeated clicks, retries, webhook replay, and order-transaction failure.

This endpoint prepares a payment only. It does not reserve stock, confirm/capture
payments, create orders, or finish #19. Finalization must revalidate independently.
Order transaction/capture changes remain a separate approval checkpoint.

## Tests and local setup

Unit tests cover request validation, customer roles, retry/conflict behavior,
provider consistency, and safe responses. Database tests cover the real route,
quote reads, persistence, concurrent requests, and ownership with Stripe mocked.
No actual Stripe requests are made by the tests.

Use a separate local Supabase instance for tests. After `npx supabase start`, put
its API URL and server secret/service-role key in ignored `.env.test.local`:

```dotenv
SUPABASE_TEST_URL=http://127.0.0.1:54321
SUPABASE_TEST_SECRET_KEY=your-local-server-key
```

These are not Storage S3 access keys. Use the actual port printed by your local
instance. Apply pending local migrations with `npx supabase migration up --local`,
then run `npm test`. Do not reset a database containing demo data. Existing DB
suites intentionally skip if either test variable is absent. The health test
currently assumes the database is named `postgres`.

For the app, keep its database settings and Stripe test key in `.env.local`.
Delivery validation also requires `OFS_STORE_LATITUDE`, `OFS_STORE_LONGITUDE`, and
`OFS_DELIVERY_RADIUS_METERS`; team-approved values are still required.

References: [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests),
[manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).
