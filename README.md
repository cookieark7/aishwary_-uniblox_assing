# Uniblox backend

Node 20+ / TypeScript (strict) / Express 5 / PostgreSQL (`pg`) / zod.

Runs directly from TypeScript with `tsx`. There is no build step; `tsc --noEmit` is used only for type checking.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your Neon connection string. Use the **direct (non-pooled)** host,
   the one without `-pooler`, and keep `sslmode=require`. `.env` is git-ignored and must never be committed.

   | Variable            | Required   | Default | Notes                                          |
   | ------------------- | ---------- | ------- | ---------------------------------------------- |
   | `DATABASE_URL`      | yes        | none    | `postgres://` or `postgresql://` URL           |
   | `PORT`              | no         | `3000`  | Integer between 1 and 65535                    |
   | `TEST_DATABASE_URL` | tests only | none    | Separate database, **wiped before every test** |

   The process refuses to start if `DATABASE_URL` or `PORT` is invalid.

3. Create the schema and seed data (this drops and recreates every table):

   ```bash
   npm run db:setup
   ```

   ```bash
   npm run db:setup:test
   ```

   > `pg` currently treats `sslmode=require` as `verify-full`, so it fully verifies the server certificate. That works with Neon.
   > At startup it prints a one-time `SECURITY WARNING` about this; the warning is informational.

## Scripts

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Start with file watching (`tsx watch`)        |
| `npm start`             | Start the server (`tsx src/server.ts`)        |
| `npm run typecheck`     | `tsc --noEmit`                                |
| `npm test`              | Run the vitest suite once                     |
| `npm run format`        | Format everything with prettier               |
| `npm run db:setup`      | Reset + seed the `DATABASE_URL` database      |
| `npm run db:setup:test` | Reset + seed the `TEST_DATABASE_URL` database |

Check it works:

```bash
curl localhost:3000/health
# {"status":"ok","db":"ok"}
```

Tests use supertest against `createApp()` and a real Postgres. `tests/setup.ts` points `DATABASE_URL` at
`TEST_DATABASE_URL` before the app loads. It refuses to run if that variable is missing or equals your dev `DATABASE_URL`.
Every test calls `resetDb()` first, and test files run one at a time (`fileParallelism: false`).

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

### `POST /carts/:cartId/checkout` → `201`

Turns the cart into an order. The request needs an `Idempotency-Key` header. No body fields are accepted yet,
so send no body or `{}`.

```bash
curl -X POST localhost:3000/carts/$CART/checkout -H "Idempotency-Key: $(uuidgen)"
```

The response is the order view (see `GET /orders/:orderId`).

Everything runs in **one transaction**, in this order:

1. Claim the idempotency key, or replay the stored response (see below).
2. Close the cart: `UPDATE carts SET status = 'checked_out' … WHERE status = 'open'`.
3. Lock the cart's products with `FOR UPDATE`, ordered by product id, and read the current price and stock.
4. If any line has `stock < quantity`, fail with `409 INSUFFICIENT_STOCK`. The details list **every** short line.
5. Decrement stock.
6. Compute totals in integer paise: `subtotal = Σ price × quantity`, `discount = 0` for now, `total = subtotal − discount`.
7. Insert the order and an `order_items` snapshot holding the name and price at checkout time.
8. Store the `201` response against the idempotency key.

Any error rolls back all of it, including the key claim. The cart stays open, stock is untouched, and a retry
runs from scratch. Locks are always taken in the same order (key, then cart, then products by id), so concurrent
checkouts can't deadlock.

#### Idempotency-Key rules

- The header is required and must be 1–255 characters. If it's missing or empty you get `400 IDEMPOTENCY_KEY_REQUIRED`;
  if it's longer than 255 characters you get `400 VALIDATION_ERROR`.
- Keys are global, not per cart. Each key is bound to a request fingerprint:
  `sha256("POST /carts/<cartId>/checkout" + JSON(parsed body))`.
- **Same key, same request, after a success:** the stored `201` body is returned unchanged, with the header
  `Idempotent-Replayed: true`. No new order is created.
- **Same key, different request** (e.g. another cart): `422 IDEMPOTENCY_KEY_REUSED`.
- **Same key sent concurrently:** the duplicates wait on the key's unique index until the first request finishes,
  then replay its response. All of them get the same order.
- **Only successes are stored.** If a checkout fails (e.g. `409 INSUFFICIENT_STOCK`), the key is released, and
  retrying with the same key runs the checkout again.

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
  "discountCents": 0,
  "totalCents": 59999,
  "currency": "INR",
  "createdAt": "2026-10-04T15:00:00.000Z"
}
```

This view is read only from `orders` and `order_items`, never from `products`. Later changes to a product's
price or name don't affect orders already placed.

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
  checkout/idempotency.ts       Idempotency-Key parsing, request hash, claimKey() / saveResponse()
  orders/orders.routes.ts
  orders/orders.service.ts      getOrderView(): reads the order snapshot
  errors.ts      AppError + 404 and central error middleware
  app.ts         createApp(): builds the Express app (imported by tests)
  server.ts      listen() + graceful shutdown
tests/
  setup.ts       switches DATABASE_URL to TEST_DATABASE_URL
  health.test.ts
  products.test.ts
  carts.test.ts
  checkout.test.ts
```

## Error responses

Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [] } }
```

| Case                                                    | Status | `code`                                                                  |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `throw new AppError(...)`                               | custom | custom                                                                  |
| Invalid params/body (`ZodError`), e.g. a malformed UUID | 400    | `VALIDATION_ERROR` (`details: [{ path, message, code }]`)               |
| Malformed JSON body                                     | 400    | `INVALID_JSON`                                                          |
| Unknown route                                           | 404    | `NOT_FOUND`                                                             |
| Cart id not in database                                 | 404    | `CART_NOT_FOUND`                                                        |
| Order id not in database                                | 404    | `ORDER_NOT_FOUND`                                                       |
| Product id not in database                              | 404    | `PRODUCT_NOT_FOUND`                                                     |
| PUT/DELETE an item not in the cart                      | 404    | `CART_ITEM_NOT_FOUND`                                                   |
| Edit a cart whose status is not `open`                  | 409    | `CART_NOT_OPEN`                                                         |
| Cart edit: resulting quantity > current stock           | 409    | `INSUFFICIENT_STOCK` (`details: { productId, requested, available }`)   |
| Checkout: any line with stock < quantity                | 409    | `INSUFFICIENT_STOCK` (`details: [{ productId, requested, available }]`) |
| Checkout of a cart that is already checked out          | 409    | `CART_ALREADY_CHECKED_OUT`                                              |
| Checkout of a cart with no items                        | 422    | `CART_EMPTY`                                                            |
| Checkout without an `Idempotency-Key` (or empty)        | 400    | `IDEMPOTENCY_KEY_REQUIRED`                                              |
| `Idempotency-Key` reused for a different request        | 422    | `IDEMPOTENCY_KEY_REUSED`                                                |
| DB unreachable on `/health`                             | 503    | `DB_UNAVAILABLE`                                                        |
| Anything else                                           | 500    | `INTERNAL_ERROR`                                                        |

For a 500 the full error is logged on the server, and the client only gets the generic message.
