# Decisions

Stack: Node 20 + TypeScript, Express 5, PostgreSQL through `pg` (raw SQL), zod for validation, vitest + supertest
for tests. Postgres runs in Docker for local setup (only the official image, nothing else is containerised).

**Approximate time spent:** _TODO: fill in_ hours.

---

## Invariants

These are the rules that must never break. Wherever possible we let the database enforce them, so they still hold
if the application code has a bug or runs on more than one instance.

| Invariant                                               | Where it is enforced                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock never goes below zero                             | Checkout locks the product rows and re-checks stock before deducting (`checkout.service.ts`). `CHECK (stock >= 0)` on `products` as a backstop.   |
| A cart turns into at most one order                     | Checkout closes the cart with `UPDATE … WHERE status = 'open'`, and `orders.cart_id` is `UNIQUE`.                                                 |
| A checked-out cart can't be edited                      | Every cart edit locks the cart row and requires `status = 'open'` (`409 CART_NOT_OPEN`).                                                          |
| A coupon is redeemed at most once                       | Redeeming is `UPDATE coupons … WHERE status = 'available'`, and `orders.coupon_id` is `UNIQUE`.                                                   |
| A coupon is not used up by a checkout that fails        | The coupon is claimed inside the same transaction as the order, so any failure rolls the claim back.                                              |
| One coupon per milestone                                | `coupons.milestone` is `UNIQUE`, and generation uses `ON CONFLICT (milestone) DO NOTHING`.                                                        |
| Order totals always add up and are never negative       | `CHECK` constraints on `orders`: `total = subtotal − discount` and `discount ≤ subtotal`. On `order_items`: `line_total = unit_price × quantity`. |
| An order explains itself even if products change later  | `order_items` stores the product name and unit price at checkout time. The order view never reads `products`.                                     |
| Money is exact                                          | All amounts are integers in paise. No floats are stored or used in calculations.                                                                  |
| The admin report reconciles and doesn't change anything | It only reads, inside one read-only snapshot transaction, and sums the same order rows `GET /orders/:id` returns.                                 |

---

## Ambiguities and chosen semantics

**There are no users, so coupons are global.** The brief has no customers or accounts, and we didn't add a user
endpoint or a user table. So we went with a global coupon system: every nth placed order makes one coupon available,
and any cart can use it at checkout. The coupon is not tied to the person who placed the nth order. Once users exist,
the obvious change is to issue the coupon to that customer.

**Coupon generation is triggered by an admin, not automatic.** The brief says "an administrator can request coupon
generation", so placing the nth order doesn't create the coupon by itself. The admin calls `POST /admin/coupons`.

**Missed milestones accumulate.** The next milestone is `(coupons generated so far + 1) × n`, not "the latest
multiple of n". If n = 5 and 12 orders are placed before the admin generates anything, the first call gives
milestone 5 and the second gives milestone 10. A reached milestone is never skipped or lost.

**What a coupon does:**

- `x`% off the whole order.
- Single use, one coupon per order, no expiry.
- Codes look like `SAVE-K7QM2XRT` and are case-insensitive: we trim and upper-case them before lookup.

**"Successfully placed order"** means a checkout that committed. Failed checkouts don't count towards milestones and
don't show up in the report.

**Price or stock changing after an item was added to the cart:**

- **The cart doesn't store prices.** Viewing a cart always shows current prices, so a price change shows up immediately.
- **The customer pays the price at checkout time,** and that price is copied into the order. After that, product
  changes never affect the order.
- **Stock is checked twice.** Adding an item does a soft check (more than is in stock gives
  `409 INSUFFICIENT_STOCK`), but nothing is reserved. Checkout checks again for real.
- **If stock dropped below a quantity in the cart,** checkout fails with every short line listed, and the cart stays
  open so the customer can fix it.

**Quantities** must be whole numbers from 1 to 100 per request. Adding the same product again adds to the existing
line. The line total is limited only by stock.

**A retried checkout must ask for the same thing.** Checking out an already checked-out cart with the same coupon
(or no coupon both times) returns the original order. A different coupon is treated as a different request and gets
`409 CART_ALREADY_CHECKED_OUT`.

**Payment:** there is no real payment in this assignment, so a successful checkout is treated as a successful
payment. We didn't add a fake payment step, because one that always succeeds wouldn't prove anything extra.

---

## Design decisions

### Decision 1: Postgres instead of an in-memory store

**Context:** The hard part of this assignment is concurrency: two checkouts racing for the last unit, two carts
racing for one coupon, retries.

**Options considered:**

- An in-memory store with locks in the application.
- SQLite.
- Postgres.

**Choice:** Postgres.

**Why:** In-memory locks only work inside one process. They stop working the moment a second instance is started,
and the brief asks how this would work with multiple instances. Postgres already gives us transactions, row locks,
unique constraints and check constraints, which are exactly the tools these rules need.

**Consequences:** A database is needed to run the project. To keep setup simple there is a `docker-compose.yml` that
starts Postgres only, plus instructions for using any other Postgres instead.

### Decision 2: Raw SQL with light use of zod, no ORM

**Context:** Once we picked a database, we needed a way to talk to it.

**Options considered:**

- An ORM such as Prisma or TypeORM.
- A query builder such as Knex.
- Raw SQL through `pg`.

**Choice:** Raw SQL with `pg`. zod only validates request params and bodies at the edges.

**Why:** For a project this size a full ORM is overkill. More importantly, the correctness here lives in the SQL
itself (`FOR UPDATE`, `ON CONFLICT`, `WHERE status = 'open'`, check constraints), and we wanted that visible in the
code instead of hidden behind an abstraction.

**Consequences:**

- We map database snake_case to API camelCase by hand.
- We convert counts and sums with `Number()`, because `pg` returns bigint as a string.
- There is no migration tool. The schema is one `schema.sql` that is dropped and recreated (see deferred).

### Decision 3: The cart is the idempotency key

**Context:** A client may retry checkout after a timeout. A retry must not create a second order or take stock twice.

**Options considered:**

- An `Idempotency-Key` header, with a table storing each key, a hash of the request, and the saved response.
- Using the cart itself as the key.

**Choice:** The cart. A cart can become only one order. Checking out a cart that is already checked out returns the
existing order with `200` and the header `Idempotent-Replayed: true`, and writes nothing.

**Why:** We actually built the `Idempotency-Key` version first and then removed it. For this API it was overkill:

- It needed an extra table.
- The client would have to generate a key and keep it across retries, which means extra work on the frontend.
- The cart id already identifies the operation, and the client already has it.

**Consequences:**

- No extra table and nothing extra for the client to send.
- Concurrent retries are safe too: they wait for the first checkout to finish, then return the same order.
- The limit is that this only covers checkout. Other writes, like adding an item, are not retry-safe (see deferred).
- A retry with different options has to be rejected rather than replayed.

### Decision 4: Database row locks, always taken in the same order

**Context:** Concurrent checkouts must not oversell stock or double-use a coupon. Concurrent cart edits must not
lose updates.

**Options considered:**

- Optimistic concurrency (a version column, retry on conflict).
- SERIALIZABLE transactions with a retry loop.
- Row locks (`SELECT … FOR UPDATE` / conditional `UPDATE`).

**Choice:** Row locks, handled on the database side.

- **Cart edits** lock the cart row first.
- **Checkout** locks the cart, then the coupon (if one was sent), then the cart's products sorted by id.

**Why:** We handled the locking in the database because it's stable and well understood, and it keeps working with
any number of app instances. Locks are only on the rows involved, so two carts with different products never wait
for each other. Taking locks in the same order every time means two checkouts can't get stuck waiting on each other.

**Consequences:**

- The code stays simple: no retry loops.
- Checkouts for the same popular product, or the same coupon, wait in line for each other. That's correct behaviour,
  and fine at this scale.

### Decision 5: The coupon is claimed inside the checkout transaction

**Context:** A coupon must not be used by two checkouts, and must not be lost if a checkout fails.

**Options considered:**

- Reserve the coupon first and confirm it after the order is created, with a cleanup job for abandoned reservations.
- Claim the coupon in the same transaction that creates the order.

**Choice:** Same transaction.

1. Checkout closes the cart.
2. It marks the coupon `redeemed` (only if it is still `available`).
3. It checks and takes the stock, then creates the order.

If anything fails, all of it is rolled back, including the coupon.

**Why:** It's the simplest way to get both rules at once. There are no half-used coupons and no cleanup job. We claim
the coupon _before_ the stock check on purpose: a stock failure is a realistic way for a checkout to fail late, and
our tests check that the coupon comes back available afterwards.

**Consequences:**

- When two carts race for one coupon, the second one waits for the first to finish.
- If the first one succeeds, the second gets `409 COUPON_ALREADY_REDEEMED` and its cart stays open.
- If the first one fails, the second one gets the coupon.

### Decision 6: Global, admin-generated coupons with accumulating milestones

**Context:** The brief leaves coupon semantics open, and there are no users in the system.

**Options considered:**

- Create the coupon automatically when the nth order is placed.
- Generate on admin request, only for the latest milestone.
- Generate on admin request, and let missed milestones accumulate.

**Choice:** Admin request with accumulating milestones. Global coupons, single use.

**Why:** The brief explicitly has the admin request generation. Counting milestones by coupons generated (not by the
current order count) means a milestone can never be skipped just because the admin called late. The `UNIQUE`
constraint on `milestone` makes sure two admins clicking at the same time still get only one coupon.

**Consequences:** Generation is simple and safe to call repeatedly. When there's nothing to generate, it returns
`409 NO_ELIGIBLE_MILESTONE` with the current order count and the next milestone.

---

## Transactions, concurrency and idempotency

Every write runs in one transaction on one connection (`withTransaction` in `src/db/pool.ts`). If anything throws,
the whole thing is rolled back.

**Cart edits** (add / change quantity / remove):

1. Lock the cart row, and check that it is open.
2. Make the change.
3. Do the soft stock check on the resulting quantity.

Two edits on the same cart run one after the other, so 10 parallel "+1" requests end at exactly 10.

**Checkout**, in order:

1. Close the cart: `UPDATE carts SET status = 'checked_out' WHERE id = $1 AND status = 'open'`.
   - If nothing was updated and the cart exists, it's a retry: return the existing order.
   - A retry that sent a different coupon gets `409`.
2. If a coupon code was sent, claim it: `UPDATE coupons SET status = 'redeemed' WHERE code = $1 AND status = 'available'`.
3. Lock the cart's products, sorted by id. Collect _every_ line where stock is short and fail with all of them.
4. Deduct stock and compute the totals.
5. Insert the order and a snapshot of each line.

Concurrent checkouts of the _same_ cart wait on the cart lock. When the first one finishes, the others see the cart
is checked out and return the same order. If the first one failed, the next one simply checks out normally.

**Coupon generation:**

1. Count orders and coupons, and work out the next milestone.
2. Insert it with `ON CONFLICT (milestone) DO NOTHING`.

If another admin request inserted the same milestone first, ours inserts nothing and we return
`409 COUPON_ALREADY_GENERATED`.

**Report:** runs in a `REPEATABLE READ READ ONLY` transaction, so all its queries see the same moment in time and the
numbers add up even while checkouts are committing.

**What the tests cover** (60 tests, running against a real Postgres):

| Scenario                                                   | Expected result                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Oversell: 10 carts check out in parallel for 3 units       | Exactly 3 orders, stock ends at 0                                           |
| Retry storm: the same cart checked out 5 times in parallel | One `201`, four `200` replays, one order, stock taken once                  |
| Coupon race: 5 carts use the same code in parallel         | One wins, four get `409`, the losing carts stay open                        |
| Generation race: 5 parallel generate requests              | Exactly one coupon                                                          |
| Failure is not cached                                      | A checkout that fails on stock can be retried once stock is back            |
| Coupon is not lost                                         | A checkout that fails on stock leaves the coupon available for another cart |
| Report under load                                          | Report requests running during a burst of checkouts always reconcile        |

To make sure the race tests actually test something, for the oversell, coupon and coupon-generation races we
temporarily removed the lock or condition the test depends on and checked that the test failed.

---

## Money and rounding

- **Integer paise everywhere.** Prices, line totals, subtotals, discounts and totals are all integers in paise. The
  only division happens when formatting for display.
- **Discount = `floor(subtotal × percentOff / 100)`.** Flooring means the discount is never more than the
  advertised percentage, and the same cart always gets the same discount. For example, 10% of 99 paise is 9.9,
  so the discount is 9 and the total is 90.
- **Totals can't go negative.** `percentOff` is limited to 1–100, so the discount is at most the subtotal. The
  database also checks `discount ≤ subtotal` and `total = subtotal − discount`.
- **One currency, INR.** The responses say so.

---

## Error model

Every error has the same shape, so a client can branch on `code` and never has to parse the message:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": [ … ] } }
```

How we picked status codes:

| Status | Meaning                                                                  | Codes                                                                                                                                             |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | The request itself is wrong                                              | `VALIDATION_ERROR` (zod; malformed ids, bad quantities, unknown fields), `INVALID_JSON`                                                           |
| `404`  | The thing doesn't exist                                                  | `CART_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`                                                                   |
| `409`  | Conflicts with the current state; may work later or with different input | `INSUFFICIENT_STOCK`, `CART_NOT_OPEN`, `CART_ALREADY_CHECKED_OUT`, `COUPON_ALREADY_REDEEMED`, `NO_ELIGIBLE_MILESTONE`, `COUPON_ALREADY_GENERATED` |
| `422`  | Well-formed, but the content can't be processed                          | `COUPON_INVALID` (no such code), `CART_EMPTY`                                                                                                     |
| `500`  | Unexpected                                                               | `INTERNAL_ERROR`. Details are logged on the server only; nothing internal is sent to the client.                                                  |

- **Validation runs before any database access,** so a malformed UUID is a `400`, never a database error.
- **Where it helps, errors carry `details`.** For example, `INSUFFICIENT_STOCK` lists each short product with how
  many were requested and how many are available.

---

## Implemented vs deferred

**Implemented:**

- Products with seeded stock (one with limited stock: 3 headphones).
- Carts: create, view with live prices and totals, add, change quantity, remove.
- Checkout with an optional coupon. Retry-safe, oversell-safe, never loses a coupon.
- Orders as snapshots.
- Admin: generate coupons, list coupons, milestone progress, sales report.
- 60 tests against a real Postgres, including the race scenarios above.
- Docker Postgres for local setup.
- A small optional frontend in `web/` that shows the flow, every request and response, and runs the race scenarios
  live. It only demonstrates the backend; nothing in it is needed by the API.

**Deferred on purpose:**

- **Retrying non-checkout writes.** Adding an item is not retry-safe: if a client retries `POST /carts/:id/items`, the
  quantity is added twice. Changing a quantity (`PUT`) and removing an item are naturally safe to repeat. The brief
  only requires checkout retries to be safe, so we stopped there.
- **Authentication.** The `/admin` routes are marked admin-only but are open, as the brief allows. Anyone who knows a
  cart id can use that cart.
- **Stock reservation.** Carts don't hold stock. Two customers can have the last unit in their carts, and the first
  to check out gets it.
- **Migrations.** `schema.sql` is dropped and recreated by `npm run db:setup`, which is fine for evaluation but not
  for real data.
- **Bigger money columns.** Amounts are `INTEGER` paise, which caps a single order at about ₹2.1 crore. `BIGINT`
  would remove that.
- **Smaller things:**
  - Coupon expiry and per-user coupons.
  - Pagination on the admin coupon list.
  - Structured logging, metrics, rate limiting, CI.

---

## Scaling to multiple instances

**The app is stateless.** Every rule above is enforced by Postgres (row locks, conditional updates, unique and check
constraints), not by memory inside the app, so running several instances behind a load balancer doesn't change any
of the behaviour. Two instances racing for the last unit or the same coupon get exactly the same outcome as two
requests on one instance.

**What we would change for production scale:**

- **Connections.** Each instance has its own connection pool, so with many instances we'd put a connection pooler
  (PgBouncer, or the provider's pooler) in front of Postgres. Nothing relies on session state, so that works without
  code changes.
- **Hot rows.** Checkouts for the same popular product, or the same coupon, wait in line on that row. For something
  like a flash sale, we'd look at reserving stock when items are added to carts, with expiry.
- **Coupon milestone counting.** It does `COUNT(*)` over orders. With a lot of orders, we'd keep a running counter
  instead.
- **Reads.** Product, order and report reads could go to a read replica.
- **Schema changes.** These would go through a migration tool instead of drop-and-recreate.

---

## AI usage

We used Claude (through Claude Code) as a pair programmer for this assignment. The way we worked:

1. We broke the problem into steps (foundation, carts, checkout, coupon generation, coupon redemption, report).
2. For each step we wrote out the requirements and rules ourselves: the endpoints, the exact transaction order, the
   error codes, and which race tests had to exist.
3. The AI implemented each step.
4. We reviewed the code and the test output before moving to the next step.

For every rule that matters there is a test that runs the competing requests for real. For the main race tests we
also removed the lock they depend on and checked that the test failed, so we know the tests are proving something.

**Where we corrected or redirected it:**

- **Idempotency.** The first checkout implementation used an `Idempotency-Key` header with its own table storing
  request hashes and responses. It worked and was tested, but we decided it was overkill for this API and would have
  needed extra work on the client side. We had it removed and replaced with the cart-as-key approach (decision 3).
- **Database setup.** Development started on a hosted Postgres. We moved to a local Docker Postgres so reviewers
  don't depend on any private service or credentials, and kept test and dev in separate databases because the tests
  wipe theirs before every test.
- **Frontend.** We didn't want a generic UI, so we pointed it at our own frontend conventions (design tokens,
  layering, no libraries) and kept it small and focused on showing backend behaviour.

---

## Next two hours

What we'd look at first:

1. **Make adding an item retry-safe.** Either have the client send its own id with each add, or have clients set
   the quantity with `PUT` (which is already safe to repeat).
2. **Basic auth.** An API key on `/admin`, and a cart token so only the creator of a cart can use it.
3. **CI.** A GitHub Actions workflow with a Postgres service, so the race tests run on every push.
4. **The hot-product case.** Load-test many checkouts on one product to see how long they wait in line, then
   decide whether stock reservation is worth adding.
