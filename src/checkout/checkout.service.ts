import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { findOrderIdByCartId, getOrderView, type OrderView } from '../orders/orders.service.js';

export interface CheckoutOptions {
  /** Already trimmed and upper-cased by the route. */
  couponCode?: string | undefined;
}

export interface CheckoutResult {
  /** 201 when this call created the order, 200 when the cart was already checked out (a retry). */
  status: 201 | 200;
  order: OrderView;
}

interface LockedLine {
  product_id: string;
  quantity: number | string;
  name: string;
  price_cents: number | string;
  stock: number | string;
}

/**
 * Turns an open cart into an order, in ONE transaction. The cart itself is the idempotency
 * key: checking out the same cart again (with the same options) returns the order it
 * already produced.
 *
 * Any thrown error rolls back everything: the cart reopens, the coupon (if any) is
 * released, and stock is untouched, so a retry runs the checkout again.
 *
 * Locking and coupons:
 * - Lock order is always cart -> coupon -> products (by id). Nobody ever holds a product
 *   lock while waiting for a coupon or a cart, so concurrent checkouts can't deadlock.
 * - A second checkout using the same coupon code waits on the coupon's row lock. If the
 *   first commits, the second's UPDATE re-checks the row, sees 'redeemed' and gets 409
 *   COUPON_ALREADY_REDEEMED. If the first rolls back, the coupon is still 'available', so
 *   the second claims it and succeeds.
 * - The coupon is claimed BEFORE the stock check on purpose: a checkout that then fails on
 *   stock shows that the rollback releases the coupon (it is never lost on a failure).
 * - Rounding: discount = floor(subtotal * percentOff / 100) in integer paise. Flooring means
 *   the discount never exceeds the advertised percentage, and the same input always gives
 *   the same discount.
 */
export function checkout(cartId: string, options: CheckoutOptions = {}): Promise<CheckoutResult> {
  return withTransaction((client) => checkoutInTransaction(client, cartId, options.couponCode));
}

async function checkoutInTransaction(
  client: PoolClient,
  cartId: string,
  couponCode: string | undefined,
): Promise<CheckoutResult> {
  // a. Close the cart. This also takes the cart's row lock, which waits for any in-flight
  //    cart edit and makes concurrent checkouts of the same cart queue up behind this one.
  const closed = await client.query(
    `UPDATE carts SET status = 'checked_out', updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [cartId],
  );

  // Nothing was closed: the cart is missing, or this is a retry of a finished checkout.
  //
  //    Concurrent case: a parallel request for the same cart blocks in the UPDATE above on the
  //    cart's row lock until the first checkout finishes.
  //    - If the first one committed, the UPDATE re-checks the row, sees 'checked_out' and
  //      matches nothing; the queries below (new statements, so a fresh READ COMMITTED
  //      snapshot) then see the committed order, and we return that same order.
  //    - If the first one rolled back, the cart is still 'open', so the UPDATE succeeds and
  //      this request performs the checkout itself.
  if (closed.rowCount === 0) {
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM carts WHERE id = $1',
      [cartId],
    );
    const cart = rows[0];
    if (!cart) throw new AppError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);

    const orderId = await findOrderIdByCartId(client, cartId);
    if (cart.status !== 'checked_out' || orderId === null) {
      // Unreachable through the API: a cart only becomes checked_out together with its order.
      throw new Error(`Cart ${cartId} is ${cart.status} but has no order to return`);
    }
    // A retry: return the existing order and write nothing, but only if it asks for the same
    // thing. Coupon codes are compared after normalisation; either side may be absent.
    const order = await getOrderView(client, orderId);
    if ((couponCode ?? null) !== order.couponCode) {
      throw new AppError(
        409,
        'CART_ALREADY_CHECKED_OUT',
        'this cart was already checked out with different options',
        { orderId },
      );
    }
    return { status: 200, order };
  }

  // b. Claim the coupon, if one was sent. The UPDATE takes the coupon's row lock.
  let coupon: { id: string; percentOff: number } | null = null;
  if (couponCode !== undefined) {
    const claimed = await client.query<{ id: string; percent_off: number | string }>(
      `UPDATE coupons SET status = 'redeemed', redeemed_at = now()
        WHERE code = $1 AND status = 'available'
        RETURNING id, percent_off`,
      [couponCode],
    );
    const row = claimed.rows[0];
    if (!row) {
      const existing = await client.query('SELECT status FROM coupons WHERE code = $1', [
        couponCode,
      ]);
      if (existing.rowCount === 0) {
        throw new AppError(422, 'COUPON_INVALID', `Coupon ${couponCode} does not exist`);
      }
      throw new AppError(
        409,
        'COUPON_ALREADY_REDEEMED',
        `Coupon ${couponCode} has already been redeemed`,
      );
    }
    coupon = { id: row.id, percentOff: Number(row.percent_off) };
  }

  // c. Lock the cart's products in a fixed order (by id) and read fresh price and stock.
  //    Then check stock and deduct it.
  const { rows } = await client.query<LockedLine>(
    `SELECT ci.product_id, ci.quantity, p.name, p.price_cents, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1
      ORDER BY p.id
        FOR UPDATE OF p`,
    [cartId],
  );
  if (rows.length === 0) {
    throw new AppError(422, 'CART_EMPTY', `Cart ${cartId} has no items`);
  }

  const lines = rows.map((row) => {
    const unitPriceCents = Number(row.price_cents);
    const quantity = Number(row.quantity);
    return {
      productId: row.product_id,
      name: row.name,
      unitPriceCents,
      quantity,
      stock: Number(row.stock),
      // Money stays in integer minor units.
      lineTotalCents: unitPriceCents * quantity,
    };
  });

  // Report every short line at once, not just the first.
  const shortages = lines
    .filter((line) => line.stock < line.quantity)
    .map((line) => ({
      productId: line.productId,
      requested: line.quantity,
      available: line.stock,
    }));
  if (shortages.length > 0) {
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      'Not enough stock for one or more items',
      shortages,
    );
  }

  // Decrement stock. Safe without re-checking: the rows are locked until commit.
  for (const line of lines) {
    await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [
      line.productId,
      line.quantity,
    ]);
  }

  // d. Totals, in integer paise. Floor: never more than the advertised percentage.
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = coupon ? Math.floor((subtotalCents * coupon.percentOff) / 100) : 0;
  const totalCents = subtotalCents - discountCents;

  // e. The order (with its coupon) and its item snapshot (name and price as of now).
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders (cart_id, coupon_id, subtotal_cents, discount_cents, total_cents)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [cartId, coupon?.id ?? null, subtotalCents, discountCents, totalCents],
  );
  const orderId = order.rows[0]!.id;

  await client.query(
    `INSERT INTO order_items
       (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::int[])`,
    [
      orderId,
      lines.map((line) => line.productId),
      lines.map((line) => line.name),
      lines.map((line) => line.unitPriceCents),
      lines.map((line) => line.quantity),
      lines.map((line) => line.lineTotalCents),
    ],
  );

  // Read the order back on this same client (it sees our uncommitted writes).
  return { status: 201, order: await getOrderView(client, orderId) };
}
