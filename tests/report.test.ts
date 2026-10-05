import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import type { OrderView } from '../src/orders/orders.service.js';
import type { SalesReport } from '../src/reports/report.service.js';
import { resetDb } from '../src/scripts/db-setup.js';

// n = 3 and x = 10, set in tests/setup.ts.
const app = createApp();

beforeEach(async () => {
  await resetDb(process.env.TEST_DATABASE_URL!);
});

afterAll(async () => {
  await pool.end();
});

async function cartWith(items: Record<string, number>): Promise<string> {
  const cart = await request(app).post('/carts');
  for (const [productId, quantity] of Object.entries(items)) {
    const res = await request(app)
      .post(`/carts/${cart.body.id}/items`)
      .send({ productId, quantity });
    expect(res.status).toBe(200);
  }
  return cart.body.id as string;
}

function checkout(cartId: string, couponCode?: string) {
  const req = request(app).post(`/carts/${cartId}/checkout`);
  return couponCode === undefined ? req : req.send({ couponCode });
}

async function report(): Promise<SalesReport> {
  const res = await request(app).get('/admin/report');
  expect(res.status).toBe(200);
  return res.body as SalesReport;
}

/** The report must agree with itself, whatever else is happening. */
function expectInternallyConsistent(r: SalesReport) {
  expect(r.netRevenueCents).toBe(r.grossRevenueCents - r.discountsCents);
  expect(r.products.reduce((sum, p) => sum + p.grossCents, 0)).toBe(r.grossRevenueCents);
  expect(r.coupons.available + r.coupons.redeemed).toBe(r.coupons.generated);
}

const withoutTimestamp = ({ generatedAt: _ignored, ...rest }: SalesReport) => rest;

describe('GET /admin/report', () => {
  it('starts at zero and lists every product', async () => {
    const r = await report();

    expect(r).toMatchObject({
      ordersPlaced: 0,
      grossRevenueCents: 0,
      discountsCents: 0,
      netRevenueCents: 0,
      coupons: { generated: 0, available: 0, redeemed: 0 },
      currency: 'INR',
    });
    expect(r.products).toHaveLength(6);
    expect(r.products.every((p) => p.quantitySold === 0 && p.grossCents === 0)).toBe(true);
  });

  it('reconciles with the orders and coupons the API returns', async () => {
    // 3 orders earn the milestone-3 coupon; the 4th order redeems it.
    const orders: OrderView[] = [];
    const carts: Array<Record<string, number>> = [
      { p_cable: 2 },
      { p_mouse: 1 },
      { p_cable: 1, p_sticker: 3 },
    ];
    for (const items of carts) {
      orders.push((await checkout(await cartWith(items))).body);
    }
    const coupon = (await request(app).post('/admin/coupons')).body;
    const discounted = await checkout(await cartWith({ p_keyboard: 1, p_sticker: 1 }), coupon.code);
    expect(discounted.status).toBe(201);
    orders.push(discounted.body);

    const r = await report();

    // Totals equal the sums over the orders GET /orders/:id returns.
    const fetched: OrderView[] = await Promise.all(
      orders.map(async (o) => (await request(app).get(`/orders/${o.id}`)).body),
    );
    expect(r.ordersPlaced).toBe(4);
    expect(r.grossRevenueCents).toBe(fetched.reduce((s, o) => s + o.subtotalCents, 0));
    expect(r.discountsCents).toBe(fetched.reduce((s, o) => s + o.discountCents, 0));
    expect(r.netRevenueCents).toBe(fetched.reduce((s, o) => s + o.totalCents, 0));
    expect(r.discountsCents).toBe(Math.floor(((349900 + 99) * 10) / 100));

    // Quantities by product match the order lines.
    const sold = Object.fromEntries(r.products.map((p) => [p.productId, p.quantitySold]));
    expect(sold).toMatchObject({
      p_cable: 3,
      p_mouse: 1,
      p_sticker: 4,
      p_keyboard: 1,
      p_monitor: 0,
    });

    // Coupon counts match GET /admin/coupons.
    const coupons = (await request(app).get('/admin/coupons')).body as Array<{ status: string }>;
    expect(r.coupons).toEqual({
      generated: coupons.length,
      available: coupons.filter((c) => c.status === 'available').length,
      redeemed: coupons.filter((c) => c.status === 'redeemed').length,
    });
    expect(r.coupons).toEqual({ generated: 1, available: 0, redeemed: 1 });
    expectInternallyConsistent(r);
  });

  it('is read-only: repeated requests return the same numbers and change nothing', async () => {
    await checkout(await cartWith({ p_cable: 1 }));
    const before = await request(app).get('/admin/coupons/milestone');

    const first = await report();
    const second = await report();
    const third = await report();

    expect(withoutTimestamp(second)).toEqual(withoutTimestamp(first));
    expect(withoutTimestamp(third)).toEqual(withoutTimestamp(first));
    expect((await request(app).get('/admin/coupons/milestone')).body).toEqual(before.body);
  });

  it('does not count failed checkouts', async () => {
    await checkout(await cartWith({ p_cable: 1 }));
    const before = await report();

    // Fails on stock (rolled back) …
    const short = await cartWith({ p_headphones: 2 });
    await pool.query(`UPDATE products SET stock = 1 WHERE id = 'p_headphones'`);
    expect((await checkout(short)).status).toBe(409);
    // … and on an unknown coupon (rolled back).
    expect((await checkout(await cartWith({ p_mouse: 1 }), 'SAVE-NOPE2345')).status).toBe(422);

    expect(withoutTimestamp(await report())).toEqual(withoutTimestamp(before));
  });

  it('stays internally consistent while checkouts commit concurrently', async () => {
    const cartIds: string[] = [];
    for (let i = 0; i < 8; i++) cartIds.push(await cartWith({ p_cable: 1, p_sticker: 2 }));

    // Reports run in the middle of a burst of checkouts.
    const results = await Promise.all([
      ...cartIds.map((id) => checkout(id).then(() => null)),
      ...Array.from({ length: 6 }, () => report()),
    ]);

    for (const r of results) if (r) expectInternallyConsistent(r);
    const final = await report();
    expect(final.ordersPlaced).toBe(8);
    expectInternallyConsistent(final);
  });
});
