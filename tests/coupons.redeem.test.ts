import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { CartView } from '../src/carts/carts.service.js';
import type { CouponListItem } from '../src/coupons/coupons.service.js';
import { pool } from '../src/db/pool.js';
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
  const created = await request(app).post('/carts');
  expect(created.status).toBe(201);
  const cartId = (created.body as CartView).id;
  for (const [productId, quantity] of Object.entries(items)) {
    const res = await request(app).post(`/carts/${cartId}/items`).send({ productId, quantity });
    expect(res.status).toBe(200);
  }
  return cartId;
}

function checkout(cartId: string, couponCode?: string) {
  const req = request(app).post(`/carts/${cartId}/checkout`);
  return couponCode === undefined ? req : req.send({ couponCode });
}

/** Places 3 orders (1 p_cable each) and generates the milestone-3 coupon. Returns its code. */
async function earnCoupon(): Promise<string> {
  for (let i = 0; i < 3; i++) {
    expect((await checkout(await cartWith({ p_cable: 1 }))).status).toBe(201);
  }
  const res = await request(app).post('/admin/coupons');
  expect(res.status).toBe(201);
  return res.body.code as string;
}

async function couponByCode(code: string): Promise<CouponListItem> {
  const res = await request(app).get('/admin/coupons');
  return (res.body as CouponListItem[]).find((c) => c.code === code)!;
}

async function cartStatus(cartId: string): Promise<string> {
  return (await request(app).get(`/carts/${cartId}`)).body.status;
}

async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [
    productId,
  ]);
  return rows[0]!.stock;
}

describe('checkout with a coupon', () => {
  it('1. applies floor(subtotal x 10 / 100) and marks the coupon redeemed by this order', async () => {
    const code = await earnCoupon();
    // 3 x 29950 + 1 x 99 = 89949 -> 10% = 8994.9 -> floor 8994
    const cartId = await cartWith({ p_cable: 3, p_sticker: 1 });

    const res = await checkout(cartId, code);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subtotalCents: 89949,
      discountCents: 8994,
      totalCents: 80955,
      couponCode: code,
    });
    const order = await request(app).get(`/orders/${res.body.id}`);
    expect(order.body).toEqual(res.body);

    const coupon = await couponByCode(code);
    expect(coupon.status).toBe('redeemed');
    expect(coupon.redeemedOrderId).toBe(res.body.id);
    expect(coupon.redeemedAt).toEqual(expect.any(String));
  });

  it('2. rounds down: 1 x p_sticker (99) -> discount 9, total 90', async () => {
    const code = await earnCoupon();
    const cartId = await cartWith({ p_sticker: 1 });

    const res = await checkout(cartId, code);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subtotalCents: 99, discountCents: 9, totalCents: 90 });
  });

  it('3. accepts a lower-case code with surrounding spaces', async () => {
    const code = await earnCoupon();
    const cartId = await cartWith({ p_sticker: 1 });

    const res = await checkout(cartId, `  ${code.toLowerCase()}  `);

    expect(res.status).toBe(201);
    expect(res.body.couponCode).toBe(code);
    expect(res.body.discountCents).toBe(9);
  });

  it('4. unknown code -> 422 COUPON_INVALID; cart stays open, stock unchanged', async () => {
    const cartId = await cartWith({ p_mouse: 2 });

    const res = await checkout(cartId, 'SAVE-NOTACODE');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_INVALID');
    expect(await cartStatus(cartId)).toBe('open');
    expect(await stockOf('p_mouse')).toBe(100);
  });

  it('5. already redeemed -> 409 COUPON_ALREADY_REDEEMED; cart stays open', async () => {
    const code = await earnCoupon();
    expect((await checkout(await cartWith({ p_sticker: 1 }), code)).status).toBe(201);
    const second = await cartWith({ p_mouse: 1 });

    const res = await checkout(second, code);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUPON_ALREADY_REDEEMED');
    expect(await cartStatus(second)).toBe('open');
    expect(await stockOf('p_mouse')).toBe(100);
  });

  it('6. NOT LOST ON FAILURE: a stock failure releases the coupon for another cart', async () => {
    const code = await earnCoupon();
    const failing = await cartWith({ p_headphones: 2 });
    await pool.query(`UPDATE products SET stock = 1 WHERE id = 'p_headphones'`);

    const failed = await checkout(failing, code);
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await cartStatus(failing)).toBe('open');
    expect((await couponByCode(code)).status).toBe('available');

    const other = await checkout(await cartWith({ p_sticker: 1 }), code);
    expect(other.status).toBe(201);
    expect(other.body.couponCode).toBe(code);
  });

  it('7. COUPON RACE: 5 carts, same code, in parallel -> one 201, four 409s', async () => {
    const code = await earnCoupon();
    const cartIds: string[] = [];
    for (let i = 0; i < 5; i++) cartIds.push(await cartWith({ p_mouse: 2 }));

    const responses = await Promise.all(cartIds.map((id) => checkout(id, code)));

    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    expect(winners[0]!.body).toMatchObject({ discountCents: 19980, couponCode: code });
    for (const r of losers) expect(r.body.error.code).toBe('COUPON_ALREADY_REDEEMED');

    const winnerCart = winners[0]!.body.cartId as string;
    for (const id of cartIds.filter((id) => id !== winnerCart)) {
      expect(await cartStatus(id)).toBe('open');
    }
    expect(await stockOf('p_mouse')).toBe(98);
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM orders WHERE coupon_id IS NOT NULL',
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('8. retries: same code -> 200 replay; different code or no code -> 409', async () => {
    const code = await earnCoupon();
    const cartId = await cartWith({ p_sticker: 1 });
    const first = await checkout(cartId, code);
    expect(first.status).toBe(201);

    const same = await checkout(cartId, code.toLowerCase());
    expect(same.status).toBe(200);
    expect(same.headers['idempotent-replayed']).toBe('true');
    expect(same.body).toEqual(first.body);

    for (const res of [await checkout(cartId, 'SAVE-OTHERONE'), await checkout(cartId)]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'CART_ALREADY_CHECKED_OUT',
        message: 'this cart was already checked out with different options',
      });
    }
  });

  it('8b. a cart checked out without a coupon cannot be replayed with one', async () => {
    const cartId = await cartWith({ p_sticker: 1 });
    expect((await checkout(cartId)).status).toBe(201);

    expect((await checkout(cartId)).status).toBe(200);
    const withCode = await checkout(cartId, 'SAVE-ANYTHING');
    expect(withCode.status).toBe(409);
    expect(withCode.body.error.code).toBe('CART_ALREADY_CHECKED_OUT');
  });

  it('validates couponCode: empty after trimming or longer than 32 -> 400', async () => {
    const cartId = await cartWith({ p_sticker: 1 });

    for (const couponCode of ['   ', 'X'.repeat(33)]) {
      const res = await checkout(cartId, couponCode);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await cartStatus(cartId)).toBe('open');
  });
});
