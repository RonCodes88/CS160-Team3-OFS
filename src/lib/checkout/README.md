# Checkout validation — Issue #18

`previewCheckout` is the first implementation stage: server-side validation
with read-only service interfaces. It is not yet exposed as an HTTP endpoint.
The browser must never supply the service results or the verified customer ID.

The proposed input is `{ addressId, expected }`, where `expected` contains
`subtotalCents`, `totalWeight`, `deliveryFeeCents`, `taxCents`, and `totalCents`.
Money is integer cents and weight is integer hundredths of a pound. These
expected values are only compared against recomputed amounts. A mismatch
returns `TOTALS_MISMATCH` and `current` totals for review; it cannot authorize
payment. This aggregate comparison does not detect offsetting individual
price changes that leave every compared value unchanged.

The validator returns the first validation failure, with a stable error code,
message, and product ID when relevant. Missing, foreign, and ineligible addresses
share an error to avoid disclosing another customer's address. Unexpected
service failures throw and must be handled by the future route's existing
generic error handler.

## Remaining integration work

- Confirm the comparison contract with the checkout UI owner.
- Connect cart, product, and address services once their contracts are agreed.
  Address eligibility must come from geocoding/service-area checks, not a
  client boolean. Stock currently lives on `products.stock_quantity`.
- Agree on tax calculation and rounding. The required tax dependency has no
  default policy; test values are fixtures, not a proposed tax rate.
- Add the customer-only preview route using verified session identity, request
  validation, agreed HTTP status mapping, and route tests.
- Verify real adapters against the separate test database. Do not close #18
  based solely on mocked unit tests.
- Payment/finalization must recheck current data. Preview does not reserve stock
  or guarantee availability at payment time.

## Validation

Run `npm test -- src/lib/checkout/validation.test.ts`, followed by the existing
test, lint, and typecheck scripts. No additional packages are required. Unit
tests use explicit service doubles and do not access Supabase or Stripe.
