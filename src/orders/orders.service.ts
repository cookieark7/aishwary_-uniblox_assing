import type { Queryable } from '../db/pool.js';
import { AppError } from '../errors.js';

export interface OrderItemView {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderView {
  id: string;
  cartId: string;
  items: OrderItemView[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: 'INR';
  createdAt: string;
}

/** One row per order item; item columns are null only if an order somehow has no items. */
interface OrderRow {
  id: string;
  cart_id: string;
  subtotal_cents: number | string;
  discount_cents: number | string;
  total_cents: number | string;
  created_at: Date;
  product_id: string | null;
  product_name: string | null;
  unit_price_cents: number | string | null;
  quantity: number | string | null;
  line_total_cents: number | string | null;
}

/** The id of the order created from `cartId`, or null if the cart has not been checked out. */
export async function findOrderIdByCartId(db: Queryable, cartId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM orders WHERE cart_id = $1', [
    cartId,
  ]);
  return rows[0]?.id ?? null;
}

/**
 * Reads an order purely from its snapshot (orders + order_items), never from products,
 * so later price or name changes do not alter a placed order.
 */
export async function getOrderView(db: Queryable, orderId: string): Promise<OrderView> {
  const { rows } = await db.query<OrderRow>(
    `SELECT o.id, o.cart_id, o.subtotal_cents, o.discount_cents, o.total_cents, o.created_at,
            oi.product_id, oi.product_name, oi.unit_price_cents, oi.quantity, oi.line_total_cents
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = $1
      ORDER BY oi.product_id`,
    [orderId],
  );
  const first = rows[0];
  if (!first) throw new AppError(404, 'ORDER_NOT_FOUND', `Order ${orderId} not found`);

  return {
    id: first.id,
    cartId: first.cart_id,
    items: rows
      .filter((row) => row.product_id !== null)
      .map((row) => ({
        productId: row.product_id!,
        name: row.product_name!,
        unitPriceCents: Number(row.unit_price_cents),
        quantity: Number(row.quantity),
        lineTotalCents: Number(row.line_total_cents),
      })),
    subtotalCents: Number(first.subtotal_cents),
    discountCents: Number(first.discount_cents),
    totalCents: Number(first.total_cents),
    currency: 'INR',
    createdAt: first.created_at.toISOString(),
  };
}
