import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import { AppError } from '../errors.js';
import { findOrderIdByCartId, getOrderView, type OrderView } from '../orders/orders.service.js';

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
 * key: checking out the same cart again returns the order it already produced.
 *
 * Any thrown error rolls back everything, so the cart stays open and a retry runs the
 * checkout again.
 *
 * Lock order is always cart row -> product rows by id, so concurrent checkouts cannot deadlock.
 */
export function checkout(cartId: string): Promise<CheckoutResult> {
  return withTransaction((client) => checkoutInTransaction(client, cartId));
}

async function checkoutInTransaction(client: PoolClient, cartId: string): Promise<CheckoutResult> {
  // a. Close the cart. This also takes the cart's row lock, which waits for any in-flight
  //    cart edit and makes concurrent checkouts of the same cart queue up behind this one.
  const closed = await client.query(
    `UPDATE carts SET status = 'checked_out', updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [cartId],
  );

  // b. Nothing was closed: the cart is missing, or this is a retry of a finished checkout.
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
    // A retry: return the existing order and write nothing.
    return { status: 200, order: await getOrderView(client, orderId) };
  }

  // c. Lock the cart's products in a fixed order (by id) and read fresh price and stock.
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
      // f. Money stays in integer minor units.
      lineTotalCents: unitPriceCents * quantity,
    };
  });

  // d. Report every short line at once, not just the first.
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

  // e. Decrement stock. Safe without re-checking: the rows are locked until commit.
  for (const line of lines) {
    await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [
      line.productId,
      line.quantity,
    ]);
  }

  // f. Totals.
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = 0; // TODO(coupons): redeem the coupon here, inside this same transaction.
  const totalCents = subtotalCents - discountCents;

  // g. The order and its item snapshot (name and price as of now).
  const order = await client.query<{ id: string }>(
    `INSERT INTO orders (cart_id, subtotal_cents, discount_cents, total_cents)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [cartId, subtotalCents, discountCents, totalCents],
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

  // h. Read the order back on this same client (it sees our uncommitted writes).
  return { status: 201, order: await getOrderView(client, orderId) };
}
