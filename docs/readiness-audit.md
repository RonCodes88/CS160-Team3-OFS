# OFS readiness audit

Reviewed on November 15, 2026, on branch `fix/hardening`.

**Decision: the technical delivery and recovery gaps now have implementations and regression tests. Real customer rollout still requires approved commerce policies, email configuration, and Noah's tracking work.** Stripe remains in test mode and tax remains the agreed class-project policy.

This review uses the supplied problem statement, `AGENTS.md`, application code, migrations, and executable tests. The full LLD and original test plan were not available in this checkout. Alignment with those documents remains unverified. Existing changes from the previous session were preserved and tested.

## Requirement coverage

| Requirement | Current evidence | Assessment |
| --- | --- | --- |
| Browse organic groceries and search/filter | Shop pages, catalog API, active category/product filters | Implemented |
| Persistent virtual cart | Customer-owned PostgreSQL carts, current server prices and weights | Implemented; race fixes added |
| Free delivery below 20 lb, otherwise $10 | `src/lib/cart/pricing.ts`, checkout validation, order transaction | Implemented with boundary tests |
| Track each item's weight | Product and cart data, order-item snapshots | Implemented in integer hundredths of a pound |
| Reject carts above 200 lb | Cart RPC and checkout transaction | Implemented; overweight repair fixed |
| Pay online | Stripe Payment Element, idempotent attempts, signed webhooks, finalization and refund recovery | Implemented in test mode only |
| RDBMS persistence | PostgreSQL migrations for customers, stock, payments, orders, trips, history, and audit | Implemented |
| Staff inventory queries and updates | Staff dashboard, role checks, transactional inventory audit | Implemented |
| Manager product management | Create, edit, and retire APIs, audit log | Implemented |
| Robot capacity of 10 orders and 200 lb | Pure batching rules and transactional trip claim | Implemented |
| Oldest order first, minute batching, 20-minute wait | Queue RPC, batching, delivery worker | Implemented; worker must run separately |
| Optimize delivery addresses | Geographic nearest-neighbor stop ordering and Mapbox road directions | Partial; heuristic, not globally optimal |
| Mapping and location-based search | Mapbox geocoding, configured service radius, geographic batch selection | Implemented for delivery locations; no general places search UI |
| Time-based traffic events | Mapbox `driving-traffic` receives departure time for traffic-aware road paths and ETAs | Implemented; provider request verified |
| Complete delivery lifecycle | Transactional departure, vehicle APIs, authenticated simulated robot | Implemented; CLI/HTTP/database integration tested |
| Customer tracking | Existing API and placeholder page | Excluded from changes at the user's request; Noah owns this work |
| Black-box resilience | API validation, regression suites, browser cart tests | Improved; full live integration and exploratory acceptance remain required |

## Bugs fixed in this hardening work

| Defect | Result after the fix | Regression evidence |
| --- | --- | --- |
| Cart mutation waits behind checkout, then edits historical cart | Lock and select an ACTIVE cart before mutation; create a fresh cart when checkout wins | `scripts/test-cart-concurrency.py` |
| Product from a retired category can enter cart | Category activity checked under lock | `supabase/tests/cart_hardening.test.sql` |
| Manager weight edits make cart impossible to repair incrementally | Decreasing quantities and removing lines can repair an overweight cart; checkout still enforces capacity | Same SQL suite |
| Large quantity/weight multiplication can overflow integer capacity arithmetic | Cart capacity arithmetic uses bigint | Same SQL suite |
| Whole-cart responses from overlapping product updates overwrite newer UI state | Shop mutations serialize across products; cart page blocks concurrent edits and checkout while saving | Browser regression and source review |
| Denied browser storage throws before the fallback runs | Access the storage getter inside the guarded block | `checkoutApi.test.ts` |
| Checkout resume network failure can leave the UI locked | Retry path reports failure and unlocks actions | Source review; interactive checkout coverage remains limited |
| Failed repricing leaves an obsolete review available | Clear the old preview before requesting new totals | Source review |
| New payment intent reuses immutable Stripe Elements state | Remount Elements when client secret changes | Source review; live provider behavior still needs acceptance testing |
| Address selection can change while validation is pending | Disable address selection and add-address action until validation finishes | `AddressStep.test.tsx` |
| Queue/claim failures starve recovery of already committed trips | Recover pending trips independently of new queue processing | `src/lib/delivery/job.test.ts` |
| Worker route starts at provisional coordinates instead of approved store | `routeTripById` resolves the configured service-area origin | Routing service unit and DB tests |
| Repeated robot reports fail after successful acknowledgement | Arrival/delivery retries return success without duplicate history or timestamps; completed retries check original vehicle identity | `src/lib/vehicle/stopStatusService.db.test.ts` |
| NUL text reaches PostgreSQL and produces 500 errors | Address, product, and inventory boundaries reject NUL; catalog queries normalize control characters | Boundary validation tests |
| Redirect control characters can resolve outside the site | Reject control characters and backslashes | `src/lib/auth/redirects.test.ts` |
| Catalog failures escape the API's JSON error contract | Return a generic JSON 500 without database details | `src/app/api/products/errors.test.ts` |
| Auth limits interfere with repeated successful logins on a shared network | Successful attempts return their failure budget; account failures are scoped by email and IP | `src/app/api/auth/routes.test.ts` |
| Order confirmation promises an email that is never sent | Confirmation points to the displayed receipt and labels demo tax | Source review |

The redirect, auth limiter, catalog error handling, and initial control-character changes originated in the previous session. This review added regression coverage and completed the surrounding fixes.

## Resolution of the remaining audit items

| Original issue | Current status | Evidence |
| --- | --- | --- |
| No delivery departure | Fixed. One transaction selects an active AVAILABLE vehicle, validates capacity/stops, departs orders and trip, and writes history. Retries preserve one assignment. | `20261116010000_delivery_departure.sql`, departure DB tests |
| No simulated robot client | Fixed. Authenticated HTTP client resumes delivery stops and retries acknowledgements. It reports destination locations rather than physical motion. | `scripts/robot-simulator.ts`, simulator unit and CLI/HTTP/DB tests |
| No traffic-aware routing | Fixed. SDK requests `driving-traffic` with departure time. Stop ordering remains a geographic heuristic. Waiting trips require a fresh route before departure. | Mapbox request tests, real provider smoke, route freshness regression |
| Test-only commerce and demo tax | Preserved as required by AGENTS.md. These are policy restrictions, not silently enabled live charges. | Startup checks, Stripe guards, tax unit/transaction tests |
| No customer email or recurring drain | Optional Resend adapter and supervised recovery worker implemented. Disabled configuration leaves the queue unclaimed. A verified sender and API key are still required to send email. | Sender tests, notification lease DB tests, worker status smoke |
| No operational payment recovery | Fixed. Scheduled reconciliation uses the existing finalizer and verified provider metadata. Durable leases, retry limits, crash exhaustion, and operator commands are included. | Payment recovery unit/DB tests, `scripts/recovery-worker.ts` |
| Insufficient frontend interaction coverage | Checkout, staff, login, navigation, and cart browser coverage added. The combined frontend report measures 63.58% lines against a 70% target; CI holds a 60% floor. | `e2e/components.spec.ts`, `e2e/coverage.mjs` |
| Tracking | Unchanged. Noah owns its page, API, and privacy decisions. | No tracking diff |
| Process-local auth limits and spoofable headers | Fixed. PostgreSQL shares failure budgets across replicas; forwarded headers are ignored unless trusted proxy configuration is enabled. | Auth route and atomic counter DB tests, SQL permission checks |
| Worker deployment absent | Fixed. Docker worker target and opt-in supervised Compose services are included. | Dockerfile, Compose configuration, CI worker-image build |
| Vulnerable dependencies | Next and its ESLint config upgraded to 16.4.6. A scoped minimatch override fixes the remaining parser-tooling advisory. `npm audit` reports zero vulnerabilities. | Lockfile, audit gate, regression/build checks |

## Configuration and rollout limits

- Stripe live mode and the 5% demo tax remain unchanged. A real-commerce release requires an explicit policy change and matching server/database validation.
- Configure `OFS_EMAIL_PROVIDER`, `OFS_EMAIL_FROM`, and `RESEND_API_KEY` before promising emailed receipts. Resend's idempotency window is 24 hours. Review provider state before manually retrying old ambiguous sends.
- Start and supervise both delivery and recovery workers. Their Compose profile is opt-in so starting the website alone does not process an unintended database. Monitor failed ticks, queue age, and manual recovery items.
- Keep the delivery wait at the agreed 20 minutes. `OFS_DELIVERY_WAIT_MINUTES` remains configurable.
- Without a trusted proxy, every visitor shares one sign-up budget of 30 registrations per 15 minutes and one failed-login budget. A room of testers can exhaust it and see "Too many attempts". Deploy behind a proxy that sets the client IP and set `OFS_TRUST_PROXY_HEADERS=true` before a group test.
- Enable forwarded-IP trust only behind a proxy that overwrites those headers and cannot be bypassed. Otherwise authentication uses a shared conservative unknown-IP budget.
- The full LLD and original test plan remain unavailable. Stock physically lives in `products.stock_quantity`, and modules share one deployable application/database client. Resolve any stricter LLD ownership requirements before claiming full design compliance.
- Noah's tracking work is excluded. Review its shared-trip route privacy and complete its customer acceptance separately.
- Complete final acceptance on a dedicated test deployment with real Stripe test-mode webhooks, configured email, Mapbox, multiple browser sessions, and the robot simulator. Mocked provider responses do not prove inbox delivery or payment-provider deployment configuration.
- This work does not certify load capacity, external hosting settings, or a penetration test. See [worker operations](run-workers.md) and [implementation decisions](implementation-decisions.md).

## Verification record

Local checks completed against the separate local Supabase database:

| Check | Result |
| --- | --- |
| Vitest with coverage | 100 files, 1,276 tests passed |
| Unit-only CI coverage | 1,069 passed, 207 database tests skipped; coverage gates passed |
| Overall coverage | 75.76% statements, 78.03% branches, 68.66% functions, 76.98% lines |
| Checkout library coverage | 97.33% statements, 97.26% branches |
| Fee and batching coverage gates | Required 100% gates passed |
| SQL transaction tests | 3 files, 26 assertions passed |
| Two-session checkout/cart race | Passed |
| ESLint | Passed |
| TypeScript and Next route types | Passed |
| Production build | Passed |
| Chromium browser regressions | 11 tests passed; API responses mocked |
| Live end-to-end and API integration (`npm run test:e2e:live`) | 24 tests passed against the real app and local database, including a Stripe test-card payment |
| Merged frontend coverage | 63.58% lines; below the 70% target. CI enforces a 60% floor so it cannot drop |

Re-run with the commands in [the black-box checklist](black-box-checklist.md). Coverage varies when database suites are skipped. Browser coverage is not merged into the Vitest percentages above.

Use [the demo guide](demo-guide.md) for the presentation. Describe the delivery and commerce gaps explicitly rather than demonstrating seeded state as a completed integration.
