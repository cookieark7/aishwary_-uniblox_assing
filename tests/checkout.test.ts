import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { CartView } from '../src/carts/carts.service.js';
import { pool } from '../src/db/pool.js';
import type { OrderView } from '../src/orders/orders.service.js';
import { resetDb } from '../src/scripts/db-setup.js';

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

function checkout(cartId: string) {
  return request(app).post(`/carts/${cartId}/checkout`);
}

async function getCart(cartId: string): Promise<CartView> {
  const res = await request(app).get(`/carts/${cartId}`);
  expect(res.status).toBe(200);
  return res.body as CartView;
}

async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [
    productId,
  ]);
  return rows[0]!.stock;
}

async function orderCount(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM orders');
  return rows[0]!.n;
}

describe('POST /carts/:cartId/checkout', () => {
  it('1. creates an order, decrements stock and closes the cart', async () => {
    const cartId = await cartWith({ p_cable: 2, p_sticker: 1 });

    const res = await checkout(cartId);

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cartId,
      items: [
        {
          productId: 'p_cable',
          name: 'USB-C Cable',
          unitPriceCents: 29950,
          quantity: 2,
          lineTotalCents: 59900,
        },
        {
          productId: 'p_sticker',
          name: 'Sticker Pack',
          unitPriceCents: 99,
          quantity: 1,
          lineTotalCents: 99,
        },
      ],
      subtotalCents: 59999,
      discountCents: 0,
      totalCents: 59999,
      couponCode: null,
      currency: 'INR',
      createdAt: expect.any(String),
    });

    expect(await stockOf('p_cable')).toBe(498);
    expect(await stockOf('p_sticker')).toBe(199);

    const cart = await getCart(cartId);
    expect(cart.status).toBe('checked_out');
    expect(cart.orderId).toBe(res.body.id);

    const order = await request(app).get(`/orders/${res.body.id}`);
    expect(order.status).toBe(200);
    expect(order.body).toEqual(res.body);
  });

  it('2. order is a snapshot: later product price/name changes do not affect it', async () => {
    const cartId = await cartWith({ p_cable: 2, p_sticker: 1 });
    const placed = (await checkout(cartId)).body as OrderView;

    await pool.query(
      `UPDATE products SET price_cents = 1, name = 'Renamed Cable' WHERE id = 'p_cable'`,
    );

    const order = await request(app).get(`/orders/${placed.id}`);
    expect(order.status).toBe(200);
    expect(order.body).toEqual(placed);
  });

  it('3. rejects an empty cart with 422 CART_EMPTY and leaves it open', async () => {
    const cartId = await cartWith({});

    const res = await checkout(cartId);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CART_EMPTY');
    expect((await getCart(cartId)).status).toBe('open');
  });

  it('4. re-checks stock at checkout: 409 with details, nothing changes', async () => {
    const cartId = await cartWith({ p_headphones: 2 });
    await pool.query(`UPDATE products SET stock = 1 WHERE id = 'p_headphones'`);

    const res = await checkout(cartId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { productId: 'p_headphones', requested: 2, available: 1 },
    ]);
    expect((await getCart(cartId)).status).toBe('open');
    expect(await stockOf('p_headphones')).toBe(1);
    expect(await orderCount()).toBe(0);
  });

  it('4b. reports every short line, not just the first', async () => {
    const cartId = await cartWith({ p_headphones: 2, p_monitor: 2, p_cable: 1 });
    await pool.query(`UPDATE products SET stock = 1 WHERE id IN ('p_headphones', 'p_monitor')`);

    const res = await checkout(cartId);

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([
      { productId: 'p_headphones', requested: 2, available: 1 },
      { productId: 'p_monitor', requested: 2, available: 1 },
    ]);
    expect(await stockOf('p_cable')).toBe(500);
  });

  it('5. OVERSELL RACE: 10 parallel checkouts for 3 headphones -> exactly 3 orders', async () => {
    const cartIds: string[] = [];
    for (let i = 0; i < 10; i++) cartIds.push(await cartWith({ p_headphones: 1 }));

    const responses = await Promise.all(cartIds.map((id) => checkout(id)));

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf('p_headphones')).toBe(0);
    expect(await orderCount()).toBe(3);
  });

  it('6. RETRY RACE: same cart x5 in parallel -> one 201, four replayed 200s, one order', async () => {
    const cartId = await cartWith({ p_headphones: 1 });

    const responses = await Promise.all(Array.from({ length: 5 }, () => checkout(cartId)));

    const created = responses.filter((r) => r.status === 201);
    const replayed = responses.filter((r) => r.status === 200);
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(4);
    expect(created[0]!.headers['idempotent-replayed']).toBeUndefined();
    for (const r of replayed) {
      expect(r.headers['idempotent-replayed']).toBe('true');
      expect(r.body).toEqual(created[0]!.body);
    }
    expect(await orderCount()).toBe(1);
    expect(await stockOf('p_headphones')).toBe(2);
  });

  it('7. a sequential retry returns 200 with the same body as the original 201', async () => {
    const cartId = await cartWith({ p_cable: 2, p_sticker: 1 });
    const first = await checkout(cartId);
    expect(first.status).toBe(201);

    const again = await checkout(cartId);

    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await orderCount()).toBe(1);
    expect(await stockOf('p_cable')).toBe(498);
  });

  it('8. a failed checkout is not cached: it succeeds once stock is restored', async () => {
    const cartId = await cartWith({ p_headphones: 2 });
    await pool.query(`UPDATE products SET stock = 1 WHERE id = 'p_headphones'`);
    expect((await checkout(cartId)).status).toBe(409);

    await pool.query(`UPDATE products SET stock = 3 WHERE id = 'p_headphones'`);
    const retry = await checkout(cartId);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(await stockOf('p_headphones')).toBe(1);
  });

  it('9. a checked-out cart cannot be edited: 409 CART_NOT_OPEN', async () => {
    const cartId = await cartWith({ p_cable: 1 });
    expect((await checkout(cartId)).status).toBe(201);

    for (const res of [
      await request(app).post(`/carts/${cartId}/items`).send({ productId: 'p_mouse', quantity: 1 }),
      await request(app).put(`/carts/${cartId}/items/p_cable`).send({ quantity: 2 }),
      await request(app).delete(`/carts/${cartId}/items/p_cable`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CART_NOT_OPEN');
    }
  });

  it('10. 404 CART_NOT_FOUND for an unknown cart, 400 for a malformed id or an unknown body field', async () => {
    const unknown = await checkout(randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('CART_NOT_FOUND');

    const malformed = await checkout('not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const cartId = await cartWith({ p_cable: 1 });
    const withBody = await checkout(cartId).send({ giftWrap: true });
    expect(withBody.status).toBe(400);
    expect(withBody.body.error.code).toBe('VALIDATION_ERROR');
    expect((await getCart(cartId)).status).toBe('open');
  });
});

describe('GET /orders/:orderId', () => {
  it('returns 400 for a malformed id and 404 ORDER_NOT_FOUND for an unknown one', async () => {
    const malformed = await request(app).get('/orders/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const unknown = await request(app).get(`/orders/${randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});
