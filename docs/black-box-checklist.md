# OFS black-box acceptance checks

Run against a dedicated test deployment and database. Keep Stripe in test mode. Record the page, action, expected result, actual result, and browser console errors for each failure. Tracking remains with Noah and is excluded from this change.

## Customer and navigation checks

- Open the home page, shop, product detail, cart, login, register, checkout, and confirmation pages directly.
- Try malformed and unknown product IDs. Expect a not-found page rather than an unhandled exception.
- Search with punctuation, repeated query parameters, a very long query, and encoded control characters. The app must respond without database errors.
- Click add, plus, minus, remove, and navigation controls rapidly. The final cart must match the last accepted server response.
- Open two tabs for the same customer. Modify the cart in one and open checkout in the other. Changed totals or stock must require a new review.
- Submit checkout while another tab modifies the cart. The completed order snapshot must remain unchanged.
- Use Back, Forward, reload, and a direct confirmation URL. Another customer's order must remain inaccessible.
- Disable browser storage and retry checkout. Page rendering must survive.
- Interrupt the network during cart updates, address creation, and payment confirmation. Expect an error and a usable retry path.
- Check a narrow mobile viewport. The menu, cart controls, and forms must remain usable without horizontal scrolling.

## Weight and stock checks

| Cart weight | Expected fee | Expected capacity behavior |
| --- | --- | --- |
| 17.99 lb | Free | No fee warning |
| 18.00 lb | Free | Show fee warning |
| 19.99 lb | Free | Show fee warning |
| 20.00 lb | $10 | Accept |
| 199.99 lb | $10 | Accept |
| 200.00 lb | $10 | Accept |
| Above 200 lb | No accepted change | Reject addition and preserve previous cart |

- Try negative, fractional, string, null, and huge quantities through the API. Expect a client error.
- Reduce stock after adding an item. Checkout must reject unavailable quantities.
- Have two customers buy the last unit simultaneously. At most one order may consume that unit.
- Retire a product or its category after cart creation. Checkout must reject the unavailable item.
- Increase a product's weight so an existing cart exceeds capacity. The customer must be able to reduce or remove lines until checkout is valid.

## Payment checks

- Double-click payment actions and retry after a timeout with the same idempotency key. Verify one attempt and at most one order.
- Retry the same key with changed checkout data. Expect a conflict.
- Deliver duplicate and out-of-order signed Stripe events. Verify no duplicate order, stock decrement, or payment capture.
- Submit an invalid webhook signature. Expect rejection without state changes.
- Change stock or price between authorization and finalization. Verify rollback and void or refund recovery as appropriate.
- Simulate a database timeout after commit. Retry must recover the committed order.

## Staff and access checks

- Guests receive 401 for protected APIs. Wrong roles receive 403. Missing resources receive 404 where specified.
- Customers cannot read another customer's order or address. Customers cannot edit inventory or products.
- Employees can query and update inventory, but cannot create, edit, or retire products.
- Managers can manage products. Each real change writes one audit record with actor, old values, and new values.
- Repeating an unchanged update must not invent a second change. Retirement must preserve the database row.
- Submit NUL characters in address and product text and inventory search. Expect validation errors rather than 500 responses.

## Delivery checks

- Give batching 11 paid orders or more than 200 lb. No trip may exceed either limit.
- Keep a partial batch younger than 20 minutes queued. Check routing eligibility at the 20-minute boundary.
- Fail Mapbox routing. Verify `ROUTE_FAILED`, unchanged original queue priority, and no abandoned assigned orders.
- Restart the worker after a trip is claimed. Pending trips must still be retried if reading the new queue fails.
- Repeat robot arrival and delivery reports. Preserve timestamps and write only one delivered history entry.
- Have another vehicle repeat a completed delivery. Deny access.
- Verify the configured store is the route origin.

Vehicle assignment, departure transitions, robot simulation, and traffic-aware road routing now have implementations. Include them in acceptance testing against your dedicated test deployment.

## Repeatable commands

Run these from the repository root with dependencies and local Supabase available:

```sh
npm audit --audit-level=high
npm run lint
npm run typecheck
npm run test:coverage
npx supabase test db
python3 scripts/test-cart-concurrency.py
npm run test:e2e
npm run test:e2e:live
npm run test:frontend-coverage
npm run build
```

Vitest database tests use `.env.test.local`, not `.env.local`. `npm run test:e2e` mocks API responses to force failure paths. `npm run test:e2e:live` uses no mocks: it drives a real browser and real HTTP requests against the app and the local Supabase database, including a Stripe test-card payment when test keys are in `.env.local`. It creates its own accounts and products, retires those products afterwards, and refuses to run against a database that is not on this machine. It does not call Mapbox; the seeded customer's saved address is used for checkout.
