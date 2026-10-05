# Uniblox backend

Node 20+ / TypeScript (strict) / Express 5 / PostgreSQL (`pg`) / zod.

Runs directly from TypeScript with `tsx`. There is no build step; `tsc --noEmit` is used only for type checking.

## Setup

Requirements: **Node 20+** and a **Postgres 13+**. The quickest way to get Postgres is the bundled Docker Compose
file. Docker runs only the official `postgres:16-alpine` image; the app and tests run with Node.

### Quick start (Docker for Postgres)

```bash
npm install
cp .env.example .env      # defaults already point at the Docker database
npm run db:up             # docker compose up -d --wait: Postgres on localhost:5433
npm run db:setup          # create tables + seed products (dev database)
npm run db:setup:test     # same for the test database
npm test
npm run dev               # API + reviewer UI on http://localhost:3000
```

The container listens on host port **5433**, so it never clashes with a Postgres already running on 5432. On first
start it creates two databases: `uniblox_dev` (for `npm run dev`) and `uniblox_test` (wiped before every test).
Data lives in a Docker volume. `npm run db:down` stops the container, and `docker compose down -v` also deletes the data.

### Without Docker

Use any Postgres 13+: a local install, or a hosted one such as Neon. Create two empty databases and put their URLs in
`.env`:

```bash
createdb uniblox_dev
createdb uniblox_test
```

For a hosted database, add `?sslmode=require` to both URLs. On Neon, use the **direct** (non-pooled) host. `pg` then
fully verifies the certificate and prints a one-time, informational `SECURITY WARNING` at startup.

### Configuration

`.env` is git-ignored and must never be committed. The process refuses to start if any value is invalid.

| Variable                | Required   | Default | Notes                                            |
| ----------------------- | ---------- | ------- | ------------------------------------------------ |
| `DATABASE_URL`          | yes        | none    | `postgres://` or `postgresql://` URL             |
| `PORT`                  | no         | `3000`  | Integer between 1 and 65535                      |
| `COUPON_EVERY_N_ORDERS` | no         | `5`     | Integer ≥ 1. Every Nth order unlocks one coupon  |
| `COUPON_PERCENT_OFF`    | no         | `10`    | Integer 1–100. Discount of each generated coupon |
| `TEST_DATABASE_URL`     | tests only | none    | Separate database, **wiped before every test**   |

`npm run db:setup` drops and recreates every table, then seeds the products. Run it any time to reset the data.

## Scripts

| Command                 | What it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Start with file watching (`tsx watch`)                 |
| `npm start`             | Start the server (`tsx src/server.ts`)                 |
| `npm run typecheck`     | `tsc --noEmit`                                         |
| `npm test`              | Run the vitest suite once                              |
| `npm run format`        | Format everything with prettier                        |
| `npm run db:up`         | Start the Docker Postgres and wait until it is healthy |
| `npm run db:down`       | Stop the Docker Postgres (data is kept)                |
| `npm run db:setup`      | Reset + seed the `DATABASE_URL` database               |
| `npm run db:setup:test` | Reset + seed the `TEST_DATABASE_URL` database          |

Check it works:

```bash
curl localhost:3000/health
# {"status":"ok","db":"ok"}
```

Tests use supertest against `createApp()` and a real Postgres. `tests/setup.ts` points `DATABASE_URL` at
`TEST_DATABASE_URL` before the app loads. It refuses to run if that variable is missing or equals your dev `DATABASE_URL`.
Every test calls `resetDb()` first, and test files run one at a time (`fileParallelism: false`).

## Reviewer UI

The server also serves a small frontend from `web/`. It's the quickest way to walk through the whole flow and
watch the backend's behaviour. Start the server and open it:

```bash
npm run dev
```

Then go to <http://localhost:3000>. It's served by the API itself, so there's nothing extra to install or build.

| Page (key)       | What it shows                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Shop** (1)     | Live stock and a cart. Try quantities like 0, 101 or 1.5, or more than is in stock, and see the server's 400 / 409.                   |
| **Checkout** (2) | The checkout transaction as a timeline: which step passed, which one failed, and the rollback. "Retry checkout" shows the 200 replay. |
| **Orders** (3)   | Order receipts, re-read from the snapshot (`GET /orders/:id`).                                                                        |
| **Coupons** (4)  | Admin only: milestone progress, coupon generation, redemption status.                                                                 |
| **Race lab** (5) | One click fires the concurrency scenarios from the test suite (oversell, retry storm, coupon race, …) and checks each invariant live. |

The **Network** panel on the right lists every request the UI makes:

- method, path, status and timing;
- the API's error code;
- an `Idempotent-Replayed` badge when that header is set;
- the request and response JSON, on click.

The panel groups requests by what triggered them, so a Race lab burst reads as one block.

> The Race lab and checkout write real orders and use real stock in whatever database `DATABASE_URL` points at.
> Reset it any time with `npm run db:setup`.

### How the frontend is built

Plain ES modules, `fetch`, and CSS custom properties. There are no frameworks, libraries or build step. Imports only
ever point down these layers:

```
web/
  index.html               app shell: sidebar │ page │ network inspector
  styles/                  tokens.css (design tokens) → base → components → layout → features
  src/lib/utils/           h() (JSX stand-in), cn(), icons, formatting, mount()
  src/lib/constants/       config objects: SECTIONS, CHECKOUT_STEPS, ERROR_CODES, LAB_SCENARIOS
  src/lib/api/             client.js (the only fetch call; ApiError) + endpoints.js (every URL)
  src/lib/state/           one immutable store; one module of actions per feature
  src/components/common/   ui atoms (Button, Badge, Callout, JsonView, …) + layout (Sidebar, TopBar)
  src/components/<feature>/  catalog, cart, checkout, orders, coupons, lab, inspector
  src/pages/               one function per page, composed from the components
  src/main.js              mounts the three regions, routing, keyboard shortcuts
```

- **Server data is the source of truth.** Prices, totals and discounts are shown exactly as the API returned them,
  never recomputed in the browser. Anything that can be derived (counts, the checkout timeline, "can check out") is
  computed at render time and never stored, so it can't go stale.
- **Stale responses are handled explicitly.**
  - Reloading products aborts the previous request (`AbortController`).
  - Cart edits can't be cancelled, so only the latest edit's response is applied. If edits overlapped, one final
    `GET` shows the true state.
- **Re-rendering is region-based.** Each region (sidebar, page, inspector) re-renders only when its slice of the store
  changes. Keyboard focus is carried across re-renders, so keyboard users never lose their place.
- **Text is never set as HTML.** Server data is always inserted as text nodes, so it can't inject markup.

## API

Money is always in integer minor units (paise), in fields ending in `Cents`. JSON keys are camelCase.

### `GET /products`

```json
[{ "id": "p_mouse", "name": "Wireless Mouse", "priceCents": 99900, "stock": 100 }]
```

### `POST /carts` → `201`

No body. Returns an empty cart view.

```json
{
  "id": "6f1c0e8a-2b7e-4d55-9f0e-0c6a4b1d2e3f",
  "status": "open",
  "items": [],
  "itemCount": 0,
  "subtotalCents": 0,
  "currency": "INR"
}
```

### `GET /carts/:cartId` → `200`

Returns the cart view.

```json
{
  "id": "6f1c0e8a-2b7e-4d55-9f0e-0c6a4b1d2e3f",
  "status": "open",
  "orderId": null,
  "items": [
    {
      "productId": "p_mouse",
      "name": "Wireless Mouse",
      "unitPriceCents": 99900,
      "quantity": 2,
      "lineTotalCents": 199800,
      "availableStock": 100,
      "inStock": true
    }
  ],
  "itemCount": 2,
  "subtotalCents": 199800,
  "currency": "INR"
}
```

- `unitPriceCents` is the product's **current** price. Carts never store prices, so a price change shows up on the next read.
- `inStock` is `availableStock >= quantity`.
- `orderId` is `null` while the cart is open and holds the order id once it has been checked out.
- `itemCount` is the total number of units, i.e. the sum of all quantities, not the number of lines.
- Items are ordered by `productId`.

### Cart edits

Every edit returns `200` with the updated cart view. Each edit runs in one transaction that starts with
`SELECT … FROM carts WHERE id = $1 FOR UPDATE`, so concurrent edits to the same cart run one after another.

| Request                                  | Body                                        | Effect                                                     |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `POST /carts/:cartId/items`              | `{ "productId": "p_mouse", "quantity": 2 }` | Adds to the existing quantity (creates the line if needed) |
| `PUT /carts/:cartId/items/:productId`    | `{ "quantity": 5 }`                         | Sets the quantity                                          |
| `DELETE /carts/:cartId/items/:productId` | none                                        | Removes the line                                           |

- `cartId` must be a UUID. `quantity` must be an integer from 1 to 100; this limit applies to each request.
  Unknown body fields are rejected.
- The stock check is a soft one. The **resulting** line quantity must not exceed the product's current stock,
  otherwise you get `409 INSUFFICIENT_STOCK` and nothing changes. Nothing is reserved; checkout re-checks.

```bash
curl -X POST localhost:3000/carts/$CART/items \
  -H 'content-type: application/json' \
  -d '{"productId":"p_headphones","quantity":4}'
```

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 3 of p_headphones available, 4 requested",
    "details": { "productId": "p_headphones", "requested": 4, "available": 3 }
  }
}
```

### `POST /carts/:cartId/checkout` → `201` (or `200` on a retry)

Turns the cart into an order. The body is optional:

```json
{ "couponCode": "SAVE-K7QM2XRT" }
```

- `couponCode` is optional, 1–32 characters after trimming. It is trimmed and upper-cased, so `" save-k7qm2xrt "` works too.
  Any other field gives `400 VALIDATION_ERROR`.
- The response is the order view (see `GET /orders/:orderId`).

```bash
curl -X POST localhost:3000/carts/$CART/checkout \
  -H 'content-type: application/json' -d '{"couponCode":"SAVE-K7QM2XRT"}'
```

Everything runs in **one transaction**, in this order:

1. Close the cart: `UPDATE carts SET status = 'checked_out' … WHERE id = $1 AND status = 'open'`.
   If no row changed, either the cart doesn't exist (`404 CART_NOT_FOUND`), or it was already checked out.
   In the second case this is a retry (see [Retries](#retries)).
2. If a `couponCode` was sent, claim it:
   `UPDATE coupons SET status = 'redeemed' … WHERE code = $1 AND status = 'available'`.
   An unknown code gives `422 COUPON_INVALID`; an already redeemed one gives `409 COUPON_ALREADY_REDEEMED`.
3. Lock the cart's products with `FOR UPDATE`, ordered by product id, and read the current price and stock.
   - No items gives `422 CART_EMPTY`.
   - If any line has `stock < quantity`, fail with `409 INSUFFICIENT_STOCK`. The details list **every** short line.
   - Otherwise, decrement stock.
4. Compute totals in integer paise:
   - `subtotal = Σ price × quantity`
   - `discount = floor(subtotal × percentOff / 100)`, or 0 without a coupon
   - `total = subtotal − discount`
5. Insert the order (with its `coupon_id`) and an `order_items` snapshot holding the name and price at
   checkout time. Return `201` with the order.

Any error rolls back all of it: the cart stays open, the coupon stays available, and stock is untouched.
Locks are always taken in the same order (cart, then coupon, then products by id), so concurrent checkouts
can't deadlock.

#### Retries

Checkout is safe to retry, and no extra header is needed: **the cart itself is the idempotency key**. A cart can
become an order only once (`orders.cart_id` is `UNIQUE`), and checking out the same cart always returns that same order.

- **First successful call:** `201` with the new order.
- **Any later call for the same cart with the same options:** `200` with the same order body, plus the header
  `Idempotent-Replayed: true`. Nothing is written again. "Same options" means the same `couponCode` after
  normalisation, or no code both times.
- **A later call with different options** (another code, a code when the original had none, or the other way
  round): `409 CART_ALREADY_CHECKED_OUT`, with the message "this cart was already checked out with different options".
- **Concurrent calls for the same cart:** they queue on the cart's row lock. Exactly one gets `201`; the others
  wait for it to finish, then get `200` with the same order.
- **Failures aren't remembered.** If a checkout fails (e.g. `409 INSUFFICIENT_STOCK` or `422 CART_EMPTY`), the
  cart stays open and any coupon it tried to use stays available. You can fix the problem and call checkout again.

Stock failure example (note `details` is an **array** here, one entry per short line):

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for one or more items",
    "details": [{ "productId": "p_headphones", "requested": 2, "available": 1 }]
  }
}
```

### `GET /orders/:orderId` → `200`

```json
{
  "id": "0b8f6a3e-6f0c-4b0e-9f57-2a4b8d1c3e5f",
  "cartId": "6f1c0e8a-2b7e-4d55-9f0e-0c6a4b1d2e3f",
  "items": [
    {
      "productId": "p_cable",
      "name": "USB-C Cable",
      "unitPriceCents": 29950,
      "quantity": 2,
      "lineTotalCents": 59900
    },
    {
      "productId": "p_sticker",
      "name": "Sticker Pack",
      "unitPriceCents": 99,
      "quantity": 1,
      "lineTotalCents": 99
    }
  ],
  "subtotalCents": 59999,
  "discountCents": 5999,
  "totalCents": 54000,
  "couponCode": "SAVE-K7QM2XRT",
  "currency": "INR",
  "createdAt": "2026-10-04T15:00:00.000Z"
}
```

This view is read only from `orders` and `order_items`, never from `products`. Later changes to a product's
price or name don't affect orders already placed. `couponCode` is `null` for an order without a coupon. It comes
from a join to `coupons`, and a coupon's code never changes.

## Coupons

### How milestones work

- Every `COUPON_EVERY_N_ORDERS`-th order (default 5) earns one coupon, worth `COUPON_PERCENT_OFF` percent (default 10).
- Coupons are **not** created automatically. An admin generates them with `POST /admin/coupons`.
- Milestones are counted by coupons generated so far: the next milestone is `(coupons generated + 1) × N`.
  So milestones nobody has generated yet **accumulate**. With N = 5 and 12 orders placed, two calls give
  milestones 5 and 10, and a third call returns `409` until order 15.
- A coupon is single-use. Its status goes from `available` to `redeemed` exactly once, at a successful checkout.

> **Admin only.** The `/admin` routes are meant for store staff. Per the brief there is no authentication yet,
> so anyone who can reach the server can call them. Put them behind auth (or a private network) before real use.

### `POST /admin/coupons` → `201`

Admin only. Generates the coupon for the next milestone. No body.

```json
{
  "id": "3b0c3c55-9a0e-4f3d-8d2e-5f2a7c1b9e40",
  "code": "SAVE-K7QM2XRT",
  "milestone": 5,
  "percentOff": 10,
  "status": "available",
  "createdAt": "2026-10-04T17:30:00.000Z"
}
```

- Codes are `SAVE-` plus 8 characters from `A–Z` and `2–9`, drawn with `crypto.randomInt`.
- No milestone reached yet: `409 NO_ELIGIBLE_MILESTONE`, `details: { ordersPlaced, nextMilestoneAt }`.
- Two admins generating at the same moment: `UNIQUE(milestone)` lets only one insert win. The other gets
  `409 COUPON_ALREADY_GENERATED` (or `NO_ELIGIBLE_MILESTONE` if it started after the winner finished).

### `GET /admin/coupons` → `200`

Admin only. All coupons, newest first, including redemption info. Once a coupon is redeemed, `status` is
`"redeemed"`, `redeemedAt` is set, and `redeemedOrderId` points at the order that used it.

```json
[
  {
    "id": "3b0c3c55-9a0e-4f3d-8d2e-5f2a7c1b9e40",
    "code": "SAVE-K7QM2XRT",
    "milestone": 5,
    "percentOff": 10,
    "status": "available",
    "createdAt": "2026-10-04T17:30:00.000Z",
    "redeemedAt": null,
    "redeemedOrderId": null
  }
]
```

### `GET /admin/coupons/milestone` → `200`

Admin only, read-only. Progress towards the next coupon, so a UI can show it without calling `POST`:

```json
{
  "everyNOrders": 5,
  "percentOff": 10,
  "ordersPlaced": 12,
  "couponsGenerated": 1,
  "nextMilestoneAt": 10,
  "eligible": true
}
```

### Redeeming a coupon

Send `{ "couponCode": "…" }` to `POST /carts/:cartId/checkout`. The coupon is claimed inside the checkout
transaction, so it is used if and only if the order is created:

- If checkout fails for any reason (e.g. out of stock), the coupon goes back to `available`.
- If several carts try the same code at once, exactly one wins. The others wait on the coupon's row lock,
  then see it is redeemed and get `409 COUPON_ALREADY_REDEEMED`, and their carts stay open.

### Rounding

`discountCents = floor(subtotalCents × percentOff / 100)`, all in integer paise. Flooring means the discount never
exceeds the advertised percentage, and the same cart always gets the same discount. For example, 10% of 99 paise
is 9.9, so the discount is 9 and the total is 90.

### Coupon error codes

| Case                                                         | Status | `code`                                                                 |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------- |
| `POST /admin/coupons` before the next milestone is reached   | 409    | `NO_ELIGIBLE_MILESTONE` (`details: { ordersPlaced, nextMilestoneAt }`) |
| Another request just generated the coupon for this milestone | 409    | `COUPON_ALREADY_GENERATED` (`details: { milestone }`)                  |
| Checkout with a code that doesn't exist                      | 422    | `COUPON_INVALID`                                                       |
| Checkout with a code that has already been redeemed          | 409    | `COUPON_ALREADY_REDEEMED`                                              |

## Admin report

### `GET /admin/report` → `200`

Admin only, read-only. A sales summary that reconciles with the orders and coupons the API returns:

```json
{
  "ordersPlaced": 4,
  "grossRevenueCents": 499547,
  "discountsCents": 34999,
  "netRevenueCents": 464548,
  "products": [
    { "productId": "p_cable", "name": "USB-C Cable", "quantitySold": 3, "grossCents": 89850 },
    {
      "productId": "p_headphones",
      "name": "Noise-Cancelling Headphones",
      "quantitySold": 0,
      "grossCents": 0
    }
  ],
  "coupons": { "generated": 1, "available": 0, "redeemed": 1 },
  "currency": "INR",
  "generatedAt": "2026-10-05T14:00:00.000Z"
}
```

- **Sums come from order snapshots.** Gross = Σ order subtotals, discounts = Σ order discounts, net = Σ order totals.
  So `net = gross − discounts`, and Σ `products[].grossCents` = gross. Current product prices are never used.
- **Every product is listed,** including ones that never sold.
- **One consistent snapshot.** All the queries run in one `REPEATABLE READ READ ONLY` transaction, so the numbers agree
  with each other even while checkouts are committing.
- **Nothing is written.** Calling it repeatedly returns the same numbers (apart from `generatedAt`).

## Layout

```
src/
  config.ts      env loading + zod validation (crashes on invalid config)
  db/pool.ts     single pg Pool + withTransaction(fn)
  db/schema.sql  tables (dropped and recreated by resetDb)
  db/seed.sql    seed products
  scripts/db-setup.ts   resetDb(url) + the db:setup CLI
  products/products.routes.ts
  carts/carts.routes.ts   HTTP + zod validation
  carts/carts.service.ts  SQL; takes a pg client so it can run inside a caller's transaction
  checkout/checkout.service.ts  the checkout transaction
  orders/orders.routes.ts
  admin/admin.routes.ts          /admin/coupons and /admin/report (admin only, no auth yet)
  coupons/coupons.service.ts     getMilestoneStatus(), generateCoupon(), listCoupons()
  reports/report.service.ts      getReport(): the admin sales summary
  orders/orders.service.ts      getOrderView() (reads the order snapshot), findOrderIdByCartId()
  errors.ts      AppError + 404 and central error middleware
  app.ts         createApp(): builds the Express app (imported by tests)
  server.ts      listen() + graceful shutdown
tests/
  setup.ts       switches DATABASE_URL to TEST_DATABASE_URL
  health.test.ts
  products.test.ts
  carts.test.ts
  checkout.test.ts
  coupons.generate.test.ts
  coupons.redeem.test.ts
  report.test.ts
web/             reviewer UI (see "Reviewer UI" above), served by app.ts as static files
docker-compose.yml               local Postgres only (postgres:16-alpine on port 5433)
docker/postgres/init/            first-start SQL: creates the test database
```

## Error responses

Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [] } }
```

| Case                                                            | Status | `code`                                                                  |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `throw new AppError(...)`                                       | custom | custom                                                                  |
| Invalid params/body (`ZodError`), e.g. a malformed UUID         | 400    | `VALIDATION_ERROR` (`details: [{ path, message, code }]`)               |
| Malformed JSON body                                             | 400    | `INVALID_JSON`                                                          |
| Unknown route                                                   | 404    | `NOT_FOUND`                                                             |
| Cart id not in database                                         | 404    | `CART_NOT_FOUND`                                                        |
| Order id not in database                                        | 404    | `ORDER_NOT_FOUND`                                                       |
| Product id not in database                                      | 404    | `PRODUCT_NOT_FOUND`                                                     |
| PUT/DELETE an item not in the cart                              | 404    | `CART_ITEM_NOT_FOUND`                                                   |
| Edit a cart whose status is not `open`                          | 409    | `CART_NOT_OPEN`                                                         |
| Cart edit: resulting quantity > current stock                   | 409    | `INSUFFICIENT_STOCK` (`details: { productId, requested, available }`)   |
| Checkout: any line with stock < quantity                        | 409    | `INSUFFICIENT_STOCK` (`details: [{ productId, requested, available }]`) |
| Checkout of a cart with no items                                | 422    | `CART_EMPTY`                                                            |
| Retry of a checked-out cart with a different `couponCode`       | 409    | `CART_ALREADY_CHECKED_OUT`                                              |
| Checkout with an unknown coupon code                            | 422    | `COUPON_INVALID`                                                        |
| Checkout with an already redeemed coupon code                   | 409    | `COUPON_ALREADY_REDEEMED`                                               |
| Coupon generation before the next milestone                     | 409    | `NO_ELIGIBLE_MILESTONE` (`details: { ordersPlaced, nextMilestoneAt }`)  |
| Coupon for this milestone was just generated by another request | 409    | `COUPON_ALREADY_GENERATED` (`details: { milestone }`)                   |
| DB unreachable on `/health`                                     | 503    | `DB_UNAVAILABLE`                                                        |
| Anything else                                                   | 500    | `INTERNAL_ERROR`                                                        |

For a 500 the full error is logged on the server, and the client only gets the generic message.
