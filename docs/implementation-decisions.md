# Readiness implementation decisions

This change preserves the project's Stripe test-mode restriction and 5% demo tax. Neither policy is silently converted into real commerce. Noah owns tracking; its page, API, and data contract are unchanged.

## Delivery departure

The delivery worker calls `delivery_dispatch_trip` after routing and retries waiting ROUTED trips on subsequent ticks. PostgreSQL owns vehicle selection, capacity revalidation, stop validation, departure state, and order history in one transaction. A retained trip-to-vehicle link identifies the assignment after completion. When no active AVAILABLE vehicle exists, the trip waits.

An alternative was to select a vehicle in TypeScript and update several tables independently. That allows two workers to reserve one robot or to leave orders partly dispatched after a crash, so the transaction owns the operation.

The simulator is an authenticated HTTP client. It uses the same vehicle APIs as a robot and resumes from persisted stop status. It reports locations at stops rather than simulating physical navigation or road safety.

## Traffic-aware routes

The routing adapter requests Mapbox `driving-traffic` and sends the actual UTC departure time through the SDK's `departAt` parameter. Stop ordering remains a bounded geographic nearest-neighbor heuristic. Mapbox calculates traffic-aware road paths and travel times for that sequence. This avoids a factorial search or dozens of billable requests for every batch.

The departure time also anchors order ETAs. These are provider predictions, not guaranteed delivery times. See [Mapbox Directions documentation](https://docs.mapbox.com/api/navigation/directions/) for profile and departure-time behavior.

## Recovery workers

Payment recovery scans durable attempts and reuses the same finalization workflow as browser confirmation and webhooks. An unlinked attempt searches Stripe metadata and verifies a unique matching test-mode intent. It never creates a replacement charge to resolve uncertainty. Leases prevent competing workers from owning the same recovery item; exhausted attempts become visible for operator review.

Notification sending has a separate claim token, so a stale sender cannot acknowledge a reclaimed notification. Provider requests use a stable notification idempotency key. Disabled email configuration leaves the queue untouched. The optional Resend adapter requires a verified sender and API key.

Keeping these jobs only in request callbacks would leave old failures and delivery notifications dependent on another customer request. A supervised recurring worker supplies progress independently of website traffic.

## Authentication limits

PostgreSQL counters replace per-process production counters. Registration, login IP, login email-plus-IP, and account-wide failure budgets have separate scopes. Identities are hashed in the counter table. Successful logins refund their consumed failure budget. Unknown database outcomes deny the request rather than skipping the limiter.

Forwarded client IP headers are ignored unless the deployment explicitly trusts a proxy that overwrites them. Without such a proxy, requests share the conservative unknown-IP budget. Adding replicas therefore cannot reset the shared database counters.
