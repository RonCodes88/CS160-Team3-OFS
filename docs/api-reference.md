# API reference

Every handler lives in `src/app/api/<path>/route.ts`. This page lists each endpoint with its inputs, outputs, and error codes as implemented. For the reasoning behind the larger workflows, read [API flows](api-flows.md).

## Conventions

- **Sessions.** Login and registration set an httpOnly `ofs_session` cookie that lasts 7 days. The cookie holds a random token; the database stores only its SHA-256 hash. Every protected handler calls `requireRole` (`src/lib/auth/requireRole.ts`) before touching data.
- **Identity.** The user ID and role always come from the session. No endpoint accepts a user ID, role, price, weight, or coordinate from the request body.
- **Units.** Money is integer cents. Weight is integer hundredths of a pound (`2000` = 20.00 lb).
- **Bodies.** Send `Content-Type: application/json`. Handlers that use `readJsonBody` return 415 otherwise, which also blocks cross-site form posts.
- **Errors.** Every error has the shape `{ "error": { "code": "...", "message": "..." } }`. Some conflicts add extra fields such as `current` or `currentQuantity`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed input (`VALIDATION_ERROR`, `INVALID_REQUEST`) |
| 401 | No valid session (`UNAUTHENTICATED`) or wrong login (`INVALID_CREDENTIALS`) |
| 403 | Signed in with the wrong role, or not the owner (`FORBIDDEN`) |
| 404 | Resource or route not found |
| 409 | The request conflicts with current data: stock, price, totals, SKU, stale edit |
| 415 | Body was not sent as JSON |
| 422 | Well-formed request that breaks a business rule: overweight cart, address outside the area |
| 429 | Rate limited (`RATE_LIMITED`, with a `Retry-After` header) |
| 500 | Unexpected failure (`INTERNAL_ERROR`); details are logged, not returned |
| 503 | A dependency is unavailable or a payment needs a retry |

## Auth

| Endpoint | Access | Body | Success |
| --- | --- | --- | --- |
| `POST /api/auth/register` | Public, rate limited per IP | `{ email, password }` | 201 `{ user }` and session cookie |
| `POST /api/auth/login` | Public, rate limited | `{ email, password }` | 200 `{ user }` and session cookie |
| `GET /api/auth/me` | Any session | none | 200 `{ user }` |
| `POST /api/auth/logout` | Any | none | 200 `{ ok: true }`, cookie cleared |

`user` is `{ id, email, role }`. Password and token hashes are never returned.

- Registration always creates a CUSTOMER. A `role` in the body is ignored. A duplicate email returns 409 `EMAIL_TAKEN`.
- Login returns the same 401 `INVALID_CREDENTIALS` for an unknown email, a wrong password, and a disabled account.
- Login checks three budgets stored in PostgreSQL: per IP, per email-and-IP pair, and per account. A successful login refunds what it consumed, so only failures count.
- Logout revokes the session row and is safe to call when already signed out.

Code: `src/lib/auth/accounts.ts`, `session.ts`, `sharedRateLimit.ts`, `password.ts` (Argon2id).

## Catalog

| Endpoint | Access | Input | Success |
| --- | --- | --- | --- |
| `GET /api/categories` | Public | none | `{ categories }` |
| `GET /api/products` | Public | `?q=` search text, `?category=` | `{ products }` |
| `GET /api/products/:productId` | Public | path ID | `{ product }` or 404 `PRODUCT_NOT_FOUND` |

Only active products are returned. Code: `src/lib/catalog/service.ts`, `query.ts`, `db.ts`.

## Cart

| Endpoint | Access | Body | Success |
| --- | --- | --- | --- |
| `GET /api/cart` | CUSTOMER | none | The active cart, created if missing |
| `POST /api/cart` | CUSTOMER | `{ productId, quantity }` | The updated cart |

`quantity` is the new line quantity, not a delta. `0` removes the line. It must be a non-negative integer.

Cart response:

```json
{
  "cart_id": "…",
  "items": [
    { "product_id": "…", "sku": "…", "name": "…", "description": "…",
      "price_cents": 399, "unit_weight": 100, "quantity": 2, "line_weight": 200 }
  ],
  "total_weight": 200,
  "subtotal_cents": 798,
  "delivery_fee_cents": 0,
  "total_cents": 798,
  "fee_warning": false,
  "over_weight_limit": false
}
```

| Error | Status | Cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad product ID or quantity |
| `PRODUCT_UNAVAILABLE` | 409 | Product is retired or missing |
| `INSUFFICIENT_STOCK` | 409 | Quantity exceeds stock |
| `CART_OVERWEIGHT` | 422 | The change would push the cart above 20000 (200.00 lb) |

A rejected change leaves the saved cart untouched. The database function `customer_set_cart_item` enforces stock and the weight limit under a row lock; `src/lib/cart/pricing.ts` computes the totals.

## Addresses

| Endpoint | Access | Body | Success |
| --- | --- | --- | --- |
| `GET /api/addresses` | CUSTOMER | none | `{ addresses }`, default first |
| `POST /api/addresses` | CUSTOMER | `{ label?, line1, line2?, city, state, postalCode }` | 201 `{ address }` |

The server geocodes the address with Mapbox and saves it only when it falls inside the service area. Coordinates are never accepted from the client.

| Error | Status | Cause |
| --- | --- | --- |
| `ADDRESS_NOT_FOUND` | 422 | Mapbox could not find the address |
| `ADDRESS_OUTSIDE_AREA` | 422 | Outside the Downtown San Jose delivery area |
| `ADDRESS_LOOKUP_UNAVAILABLE` | 503 | Mapbox or the service-area configuration is unavailable |

Code: `src/lib/auth/addresses.ts`, `geocode.ts`, `serviceArea.ts`.

## Checkout

All checkout responses send `Cache-Control: no-store`. The step-by-step workflow is in [API flows](api-flows.md#checkout-and-payment).

| Endpoint | Access | Headers | Body |
| --- | --- | --- | --- |
| `POST /api/checkout/preview` | CUSTOMER | none | `{ addressId, expected }` |
| `POST /api/checkout/payment-intent` | CUSTOMER | `Idempotency-Key` | `{ addressId, expected }` |
| `POST /api/checkout/confirm` | CUSTOMER | `Idempotency-Key` (the original) | `{ attemptId }` |
| `POST /api/checkout/cancel` | CUSTOMER | none | `{}` |
| `POST /api/webhooks/stripe` | Stripe signature | `Stripe-Signature` | Raw Stripe event |

`expected` is `{ subtotalCents, totalWeight, deliveryFeeCents, taxCents, totalCents }`: the totals the customer is looking at. The server recalculates everything and uses `expected` only to detect a stale screen.

**Preview** returns the validated quote plus `taxPolicy`. It never charges, reserves stock, or creates an order.

| Preview error | Status |
| --- | --- |
| `INVALID_REQUEST`, `ADDRESS_REQUIRED`, `INVALID_TOTALS` | 400 |
| `PRODUCT_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `TOTALS_MISMATCH` | 409 |
| `CART_UNAVAILABLE`, `CART_EMPTY`, `INVALID_CART`, `INVALID_QUANTITY`, `ADDRESS_INVALID`, `CART_OVERWEIGHT` | 422 |
| `SERVICE_AREA_UNAVAILABLE` | 503 |

A conflict can include `current` (the server's totals now) so the UI can ask the customer to review again.

**Payment intent** saves a payment attempt and prepares a Stripe PaymentIntent with manual capture. The `Idempotency-Key` must be 1 to 128 letters, digits, hyphens, or underscores (400 `INVALID_IDEMPOTENCY_KEY` otherwise). Sending the same key again returns the same attempt instead of a second charge.

**Confirm** runs the shared finalization workflow for one attempt.

| Confirm result | Status |
| --- | --- |
| Order created: `{ attemptId, status: "CAPTURED", orderId }` | 200 |
| Stripe has not finished: `{ status: "PENDING", providerStatus }` | 202 |
| Payment voided or refunded: result plus `error` with the `failureCode` | 422 |
| Outcome unknown, retry the same attempt: `PAYMENT_RECOVERY_REQUIRED` | 503 |

**Cancel** voids the customer's unfinished payment so checkout can start over.

**Webhook** verifies the Stripe signature, then runs the same finalization workflow. It returns 200 only after durable processing, and 503 `WEBHOOK_RETRY` when Stripe should send the event again.

Code: `src/lib/checkout/service.ts`, `src/lib/payments/service.ts`, `finalize.ts`, `finalize-backend.ts`, `webhook.ts`.

## Orders and tracking

| Endpoint | Access | Success |
| --- | --- | --- |
| `GET /api/orders/:orderId/tracking` | CUSTOMER, owner only | `{ tracking }` |

```json
{
  "tracking": {
    "orderId": "…",
    "status": "OUT_FOR_DELIVERY",
    "tripStatus": "OUT_FOR_DELIVERY",
    "stopStatus": "PENDING",
    "estimatedArrival": "2026-11-15T19:42:00Z",
    "destination": { "latitude": 37.34, "longitude": -121.89 },
    "route": { },
    "robotLocation": { "latitude": 37.33, "longitude": -121.88, "updatedAt": "…" }
  }
}
```

Trip, stop, ETA, route, and robot fields are `null` until the order is on a trip. `destination` comes from the address snapshot taken at checkout. Another customer's order returns 403; an unknown order returns 404.

The tracking page at `/track/<order-id>` polls this endpoint every 15 seconds and draws the route, destination, and robot on a Mapbox map. The order confirmation page (`src/app/orders/[orderId]/page.tsx`) reads the order on the server instead of through an API.

Code: `src/lib/orders/tracking.ts`, `read.ts`, `src/components/tracking/`.

## Staff inventory

| Endpoint | Access | Input | Success |
| --- | --- | --- | --- |
| `GET /api/staff/inventory` | EMPLOYEE, MANAGER | `?q=&limit=&offset=&status=` | A page of products with stock |
| `GET /api/staff/inventory/low-stock` | EMPLOYEE, MANAGER | `?threshold=&limit=&offset=` | Active products at or below the threshold (default 10) |
| `PUT /api/staff/inventory/:productId` | EMPLOYEE, MANAGER | `{ quantity, expectedQuantity? }` | The updated stock |

`q` matches name or SKU. `status=retired` lists retired products.

The stock update and its `audit_log` row are written in one transaction (`staff_set_inventory_quantity`). Setting the current value again is a no-op with no audit row. When `expectedQuantity` is sent and the stock is no longer that value, the response is 409 `CONFLICT` with `currentQuantity`, so one employee cannot silently overwrite another's edit or a checkout.

## Manager products and audit log

| Endpoint | Access | Body | Success |
| --- | --- | --- | --- |
| `POST /api/admin/products` | MANAGER | `{ sku, categoryId, name, priceCents, unitWeight, description?, imageUrl?, stockQuantity? }` | 201, the product |
| `PUT /api/admin/products/:productId` | MANAGER | Any of `{ sku, categoryId, name, description, imageUrl, priceCents, unitWeight }` | `{ product, changed }` |
| `DELETE /api/admin/products/:productId` | MANAGER | none | `{ product, changed }` |
| `POST /api/admin/products/:productId/reactivate` | MANAGER | none | `{ product, changed }` |
| `GET /api/admin/audit-log` | MANAGER | `?productId=&action=&limit=&offset=` | A page of audit rows, newest first |

- `DELETE` retires the product (`is_active = false`). Rows are never deleted, so past orders keep valid product IDs.
- Retiring or reactivating twice is a no-op (`changed: false`).
- Only fields that actually change are written and audited.
- A duplicate SKU returns 409 `CONFLICT`. An unknown category returns 400.

Code: `src/lib/products/service.ts`, `src/lib/audit/log.ts`.

## Vehicle

The simulated robot (`scripts/robot-simulator.ts`) signs in with a VEHICLE account and uses these endpoints like a real robot would.

| Endpoint | Access | Body | Success |
| --- | --- | --- | --- |
| `GET /api/vehicle/trip` | VEHICLE | none | `{ trip }` with ordered stops, or `{ trip: null }` |
| `PATCH /api/vehicle/location` | VEHICLE | `{ latitude, longitude, batteryPercent }` | `{ location }` |
| `PATCH /api/vehicle/stops/:stopId` | VEHICLE | `{ status }`: `ARRIVED` or `DELIVERED` | `{ stop, tripCompleted }` |

- `batteryPercent` is an integer from 0 to 100.
- A vehicle can update only stops on its own assigned trip. Any other stop returns 404.
- An out-of-order status returns 409 `CONFLICT`.
- `DELIVERED` marks the order DELIVERED and writes status history. Delivering the last stop completes the trip and makes the vehicle AVAILABLE again.
- Repeating a successful `DELIVERED` returns the same success, so a lost acknowledgement can be retried safely.
- Each update queues an "arrived" or "delivered" notification, and the handler sends queued notifications right after it responds.

Code: `src/lib/vehicle/assignedTrip.ts`, `locationService.ts`, `stopStatusService.ts`, and the `vehicle_update_delivery_stop` database function.

## No public endpoints

Batching, routing, and dispatch have no HTTP API. The delivery worker (`scripts/delivery-worker.ts`) owns them. Payment and notification retries belong to the recovery worker (`scripts/recovery-worker.ts`). See [worker commands](run-workers.md).
