# Run delivery, recovery, and the simulated robot

Keep Stripe in test mode. Worker commands use `.env.local` unless environment variables already supply the values. Point rehearsal commands at a dedicated test deployment. Do not start workers against a database you intend to keep unchanged.

## Start supervised workers

Apply the repository migrations before deploying the app and workers. Use `npx supabase db push --dry-run` to inspect the linked project's pending migrations, then `npx supabase db push` to apply them.

Start the local website and worker containers:

```sh
docker compose --profile workers up --build -d
```

The `delivery` and `recovery` services use the Dockerfile's `worker` target. Both restart unless stopped. The web service uses the existing development target. For a production web image, build the existing `runner` target and supply deployment environment variables.

To run workers directly:

```sh
npm run delivery:worker
npm run recovery:worker
```

Delivery checks every minute, routes eligible trips, and dispatches ROUTED trips when an active AVAILABLE vehicle exists. If no vehicle is available, the trip remains ROUTED for the next tick. Recovery handles pending payment finalization and queued notifications independently.

Inspect logs and stop the containers:

```sh
docker compose --profile workers logs --tail 100 delivery recovery
docker compose --profile workers stop delivery recovery
```

Monitor worker process health, repeated tick errors, the age of queued paid orders, and manual payment recovery items. Container restart policies do not replace alerting.

## Configure email delivery

Email is disabled by default. Set these variables in the deployment secret store:

```text
OFS_EMAIL_PROVIDER=resend
OFS_EMAIL_FROM=OFS <receipts@your-verified-domain.example>
RESEND_API_KEY=<your-provider-key>
```

Verify the sender domain with Resend before enabling delivery. A successful provider acknowledgement means the email was accepted for delivery, not that it reached the recipient's inbox. A stable notification idempotency key limits duplicates during ordinary retries. Verify provider delivery state before manually retrying an old ambiguous send, since provider deduplication windows are finite.

Missing email configuration leaves queued notifications unsent. It does not label a logged message as delivered or consume retry attempts.

## Inspect and retry recovery

These commands require backend credentials. They print operation IDs and states without customer addresses or payment payloads:

```sh
npm run recovery:worker -- --status
npm run recovery:worker -- --once
npm run recovery:worker -- --retry-payment <attempt-uuid>
npm run recovery:worker -- --retry-notification <notification-uuid>
```

Inspect exhausted or ambiguous provider operations before resetting their retry budget. Payment recovery never creates a replacement intent. An old unlinked attempt needs a unique, verified Stripe metadata match or operator investigation.

## Run the simulated robot

Set `OFS_ROBOT_BASE_URL`, `OFS_ROBOT_EMAIL`, and `OFS_ROBOT_PASSWORD`. Use a VEHICLE account from your dedicated test deployment. Local seeded credentials are documented in the README. Do not put real credentials in the committed example file.

```sh
npm run robot:simulator -- --once
npm run robot:simulator
```

The simulator signs in over HTTP, reads its assignment, posts location updates, and reports arrival and delivery. It resumes from persisted stop state and retries lost acknowledgements. `OFS_ROBOT_POLL_MS` controls idle polling. `OFS_ROBOT_STEP_MS` controls the pause between actions. This simulates API behavior rather than physical motion.

Remote HTTPS test deployments require explicit opt-in:

```sh
npm run robot:simulator -- --allow-remote --once
```

Tracking remains with Noah's separate work.

## Configure client-IP trust

`OFS_TRUST_PROXY_HEADERS=false` is the secure default. With this setting, the app ignores forwarded IP headers and uses a shared unknown-IP rate budget.

Enable the setting only behind an access-controlled proxy that replaces `X-Forwarded-For` with the actual peer address. For example, an existing Nginx deployment can set:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
```

Prevent direct access to the app server that bypasses that proxy. Do not enable trust behind a proxy that merely appends to a user-supplied header. PostgreSQL stores the counters, so the failure budgets remain shared across app replicas and restarts.
