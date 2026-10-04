import type { PoolClient } from 'pg';
import { AppError } from '../errors.js';
import { getOrderView } from '../orders/orders.service.js';
import { claimKey, saveResponse } from './idempotency.js';

export interface CheckoutInput {
  cartId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface CheckoutResult {
  status: number;
  body: unknown;
  /** True when the response is a stored one for an idempotency key that was already used. */
  replayed: boolean;
}

interface LockedLine {
  product_id: string;
  quantity: number | string;
  name: string;
  price_cents: number | string;
  stock: number | string;
}

/**
 * Turns an open cart into an order. Must run inside ONE transaction (withTransaction):
 * any thrown error rolls back everything, including the idempotency key claim, so only
 * successful checkouts are stored and a retry after a failure runs again.
 *
 * Lock order (always the same, so concurrent checkouts cannot deadlock):
 * idempotency key -> cart row -> product rows by id.
 */
export async function checkout(client: PoolClient, input: CheckoutInput): Promise<CheckoutResult> {
  const { cartId, idempotencyKey, requestHash } = input;

  // a. Claim the idempotency key, or replay the response of the request that already used it.
  const claim = await claimKey(client, idempotencyKey, requestHash);
  if (!claim.claimed) {
    return { status: claim.responseStatus, body: claim.responseBody, replayed: true };
  }

  // b. Close the cart. The row lock taken here also waits for any in-flight cart edit,
  //    and makes concurrent checkouts of the same cart queue up behind this one.
  const closed = await client.query(
    `UPDATE carts SET status = 'checked_out', updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [cartId],
  );
  if (closed.rowCount === 0) {
    const exists = await client.query('SELECT 1 FROM carts WHERE id = $1', [cartId]);
    if (exists.rowCount === 0) {
      throw new AppError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);
    }
    throw new AppError(409, 'CART_ALREADY_CHECKED_OUT', `Cart ${cartId} is already checked out`);
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

  // h. Build the response on this same client and store it against the key.
  const body = await getOrderView(client, orderId);
  await saveResponse(client, idempotencyKey, 201, body);

  return { status: 201, body, replayed: false };
}
