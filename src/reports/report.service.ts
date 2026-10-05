import type { Queryable } from '../db/pool.js';

export interface ProductSales {
  productId: string;
  name: string;
  quantitySold: number;
  /** Σ line totals for this product, before any order discount. */
  grossCents: number;
}

export interface SalesReport {
  ordersPlaced: number;
  grossRevenueCents: number;
  discountsCents: number;
  netRevenueCents: number;
  products: ProductSales[];
  coupons: { generated: number; available: number; redeemed: number };
  currency: 'INR';
  generatedAt: string;
}

/**
 * Builds the admin summary. Read-only. The caller should run it in a read-only snapshot
 * transaction, so all three queries see the same orders and coupons and the numbers
 * reconcile even while checkouts are committing.
 *
 * Everything is summed from what the orders stored at checkout time (order snapshots),
 * not from current product prices.
 */
export async function getReport(db: Queryable): Promise<SalesReport> {
  // SUM/COUNT return bigint/numeric, which pg returns as strings: Number() them.
  const totals = await db.query<{
    orders_placed: string;
    gross: string;
    discounts: string;
    net: string;
  }>(
    `SELECT COUNT(*)                         AS orders_placed,
            COALESCE(SUM(subtotal_cents), 0) AS gross,
            COALESCE(SUM(discount_cents), 0) AS discounts,
            COALESCE(SUM(total_cents), 0)    AS net
       FROM orders`,
  );

  // Every product appears, including ones that never sold.
  const products = await db.query<{
    id: string;
    name: string;
    quantity_sold: string;
    gross: string;
  }>(
    `SELECT p.id, p.name,
            COALESCE(SUM(oi.quantity), 0)         AS quantity_sold,
            COALESCE(SUM(oi.line_total_cents), 0) AS gross
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
      GROUP BY p.id, p.name
      ORDER BY p.id`,
  );

  const coupons = await db.query<{ generated: string; available: string; redeemed: string }>(
    `SELECT COUNT(*)                                     AS generated,
            COUNT(*) FILTER (WHERE status = 'available') AS available,
            COUNT(*) FILTER (WHERE status = 'redeemed')  AS redeemed
       FROM coupons`,
  );

  const t = totals.rows[0]!;
  const c = coupons.rows[0]!;
  return {
    ordersPlaced: Number(t.orders_placed),
    grossRevenueCents: Number(t.gross),
    discountsCents: Number(t.discounts),
    netRevenueCents: Number(t.net),
    products: products.rows.map((row) => ({
      productId: row.id,
      name: row.name,
      quantitySold: Number(row.quantity_sold),
      grossCents: Number(row.gross),
    })),
    coupons: {
      generated: Number(c.generated),
      available: Number(c.available),
      redeemed: Number(c.redeemed),
    },
    currency: 'INR',
    generatedAt: new Date().toISOString(),
  };
}
