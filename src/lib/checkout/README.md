# Checkout preview — Issue #18

`POST /api/checkout/preview` authenticates a CUSTOMER, reads their existing
active cart and saved address, and revalidates current products, stock, prices,
weight, delivery eligibility, and totals. It creates no cart, order, or payment;
it does not reserve stock or remove unavailable items.

## Request and response

Send JSON `{ addressId, expected }`. `addressId` must be a saved-address UUID.
`expected` must contain non-negative safe integers for `subtotalCents`,
`totalWeight`, `deliveryFeeCents`, `taxCents`, and `totalCents`. Money is cents;
weight is hundredths of a pound. Identity comes only from the session cookie.

Success returns these recalculated fields plus `feeWarning` and `taxPolicy`.
Failures return `{ error: { code, message, productId? } }`. A `TOTALS_MISMATCH`
also returns `current` totals and `taxPolicy` for customer review. Aggregate
comparison cannot detect offsetting item-price changes that leave all compared
values unchanged. All responses use `Cache-Control: no-store`.

| Status | Meaning |
| --- | --- |
| 200 | Validated preview |
| 400 | Invalid request, address UUID, or expected totals |
| 401 / 403 | Invalid session / wrong role |
| 409 | Changed totals, unavailable product/category, or insufficient stock |
| 415 | Request is not JSON |
| 422 | Empty/unavailable cart, invalid quantities, invalid address, or over 200 lb |
| 503 | Missing or invalid delivery-area configuration |
| 500 | Unexpected backend failure; internal details are not returned |

## Demo tax policy (approved 2026-10-21)

Tax is **5% of item subtotal, excluding delivery**, rounded once to the nearest
cent with half-cent values rounded up. Integer arithmetic avoids money floats.
This is a class-project simplification, not California tax compliance or Stripe
Tax. The API includes `taxPolicy` with label `Demo tax (5%)` and description
`Simplified tax rate for this class project.` The future checkout UI (#39)
should show this label and explanation; no UI changes are part of this work.

## Delivery area: configuration still awaiting team agreement

Set these server-only environment variables after the team confirms values:

- `OFS_STORE_LATITUDE`: decimal latitude, -90 through 90.
- `OFS_STORE_LONGITUDE`: decimal longitude, -180 through 180.
- `OFS_DELIVERY_RADIUS_METERS`: positive finite radius in meters.

There are deliberately no defaults. Valid saved-address coordinates are checked
using spherical great-circle distance, including the boundary. A 3-mile radius
was proposed but is NOT approved or automatically used. Missing configuration
raises `SERVICE_AREA_UNAVAILABLE` when an owned address needs eligibility
checking; earlier validation failures can still return their specific errors.

Address creation/geocoding remains the address service's responsibility. A
saved address must have a geocoded PostGIS point. This endpoint rechecks its
ownership and geographic eligibility; it does not geocode arbitrary text.

## Shared helpers and ownership

Minimal read-only helpers are included to support checkout without replacing
teammates' operations:

- Cart: `getActiveCart` in `src/lib/cart/service.ts` reads existing cart/items
  without calling the get/create RPC. Existing cart functions are preserved.
- Catalog: `getCheckoutProducts` in `src/lib/catalog/checkout.ts` reads exact
  stock internally and combines product/category active status. Retired
  categories block checkout even when stock remains. Public catalog responses
  are unchanged and do not expose exact stock.
- Auth/address: `getOwnedAddress` in `src/lib/auth/addresses.ts` calls the new
  read-only `customer_read_address_location` RPC. The query filters ownership
  and active CUSTOMER status; only the server service role may execute it.
- Checkout: `service.ts` assembles these dependencies for `previewCheckout`.

Apply the new `20261021120000_checkout_address_read.sql` migration to the
separate test database before DB tests. Existing migrations are not edited.
The older checkout/schema migration still needs review for upgrades containing
legacy status rows or existing orders/stops; clean-database tests do not prove
that upgrade path.

## Tests and remaining work

Run `npm test`, `npm run lint`, and `npm run typecheck`. Checkout unit tests use
service doubles; adapter tests use the real Supabase query builder with HTTP
responses replaced. Route tests cover authentication, input, errors, and tax
metadata. `preview.db.test.ts` exercises the real route and helpers using
isolated UUID fixtures, including ownership, stock/price changes, weight
boundaries, and read-only behavior.

DB tests run only with `SUPABASE_TEST_URL` and `SUPABASE_TEST_SECRET_KEY`
configured for a local test database (optionally in `.env.test.local`). Never
point tests at demo data. The existing CI does not provision that database, so
DB tests skip unless configured. Test-area coordinates/radii are fixtures,
not approved production settings.

Before closing #18, confirm and configure the real store location/radius and
verify eligible/ineligible addresses there. Coordinate the response contract
with the checkout UI owner. Payment/finalization must independently revalidate
prices, stock, and totals; a preview is not a stock reservation or payment
approval. No Stripe/payment or order-creation code is included here.
