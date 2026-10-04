import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { CartView } from '../src/carts/carts.service.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from '../src/scripts/db-setup.js';

const app = createApp();

// Seed prices (src/db/seed.sql)
const MOUSE = 99900;
const KEYBOARD = 349900;

beforeEach(async () => {
  await resetDb(process.env.TEST_DATABASE_URL!);
});

afterAll(async () => {
  await pool.end();
});

async function createCart(): Promise<CartView> {
  const res = await request(app).post('/carts');
  expect(res.status).toBe(201);
  return res.body as CartView;
}

function addItem(cartId: string, body: unknown) {
  return request(app)
    .post(`/carts/${cartId}/items`)
    .send(body as object);
}

async function getCart(cartId: string): Promise<CartView> {
  const res = await request(app).get(`/carts/${cartId}`);
  expect(res.status).toBe(200);
  return res.body as CartView;
}

describe('POST /carts', () => {
  it('creates an empty open cart', async () => {
    const res = await request(app).post('/carts');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'open',
      orderId: null,
      items: [],
      itemCount: 0,
      subtotalCents: 0,
      currency: 'INR',
    });
  });
});

describe('POST /carts/:cartId/items', () => {
  it('sums quantities when the same product is added twice', async () => {
    const cart = await createCart();

    expect((await addItem(cart.id, { productId: 'p_mouse', quantity: 2 })).status).toBe(200);
    expect((await addItem(cart.id, { productId: 'p_keyboard', quantity: 1 })).status).toBe(200);
    const res = await addItem(cart.id, { productId: 'p_mouse', quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        productId: 'p_keyboard',
        name: 'Mechanical Keyboard',
        unitPriceCents: KEYBOARD,
        quantity: 1,
        lineTotalCents: KEYBOARD,
        availableStock: 50,
        inStock: true,
      },
      {
        productId: 'p_mouse',
        name: 'Wireless Mouse',
        unitPriceCents: MOUSE,
        quantity: 5,
        lineTotalCents: 5 * MOUSE,
        availableStock: 100,
        inStock: true,
      },
    ]);
    expect(res.body.itemCount).toBe(6);
    expect(res.body.subtotalCents).toBe(5 * MOUSE + KEYBOARD);
  });

  it.each([0, -1, 1.5, '2', 101, null])(
    'rejects quantity %j with 400 and leaves the cart unchanged',
    async (quantity) => {
      const cart = await createCart();
      await addItem(cart.id, { productId: 'p_mouse', quantity: 1 });
      const before = await getCart(cart.id);

      const add = await addItem(cart.id, { productId: 'p_mouse', quantity });
      const put = await request(app).put(`/carts/${cart.id}/items/p_mouse`).send({ quantity });

      for (const res of [add, put]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details[0].path).toBe('quantity');
      }
      expect(await getCart(cart.id)).toEqual(before);
    },
  );

  it('rejects unknown body fields and a missing body', async () => {
    const cart = await createCart();

    const extra = await addItem(cart.id, { productId: 'p_mouse', quantity: 1, priceCents: 1 });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');

    const empty = await request(app).post(`/carts/${cart.id}/items`);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    expect((await getCart(cart.id)).items).toEqual([]);
  });

  it('returns 404 PRODUCT_NOT_FOUND for an unknown product', async () => {
    const cart = await createCart();

    const res = await addItem(cart.id, { productId: 'p_nope', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns 409 INSUFFICIENT_STOCK with details when quantity exceeds stock', async () => {
    const cart = await createCart();

    const res = await addItem(cart.id, { productId: 'p_headphones', quantity: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_STOCK',
      message: expect.any(String),
      details: { productId: 'p_headphones', requested: 4, available: 3 },
    });
    expect((await getCart(cart.id)).items).toEqual([]);
  });

  it('checks stock against the resulting quantity and rolls back on failure', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_headphones', quantity: 2 });

    const res = await addItem(cart.id, { productId: 'p_headphones', quantity: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({
      productId: 'p_headphones',
      requested: 4,
      available: 3,
    });
    expect((await getCart(cart.id)).items[0]!.quantity).toBe(2);
  });

  it('serialises concurrent adds: 10 parallel +1 requests give exactly 10', async () => {
    const cart = await createCart();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => addItem(cart.id, { productId: 'p_mouse', quantity: 1 })),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    const final = await getCart(cart.id);
    expect(final.items).toHaveLength(1);
    expect(final.items[0]!.quantity).toBe(10);
    expect(final.subtotalCents).toBe(10 * MOUSE);
  });
});

describe('cart ids', () => {
  it('returns 400 VALIDATION_ERROR (not a pg 500) for a malformed cart id', async () => {
    for (const res of [
      await request(app).get('/carts/not-a-uuid'),
      await addItem('not-a-uuid', { productId: 'p_mouse', quantity: 1 }),
      await request(app).put('/carts/123/items/p_mouse').send({ quantity: 1 }),
      await request(app).delete('/carts/123/items/p_mouse'),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 404 CART_NOT_FOUND for an unknown cart uuid', async () => {
    const id = randomUUID();
    for (const res of [
      await request(app).get(`/carts/${id}`),
      await addItem(id, { productId: 'p_mouse', quantity: 1 }),
      await request(app).put(`/carts/${id}/items/p_mouse`).send({ quantity: 1 }),
      await request(app).delete(`/carts/${id}/items/p_mouse`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CART_NOT_FOUND');
    }
  });
});

describe('PUT and DELETE /carts/:cartId/items/:productId', () => {
  it('sets the quantity, then removes the item', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_mouse', quantity: 2 });

    const put = await request(app).put(`/carts/${cart.id}/items/p_mouse`).send({ quantity: 7 });
    expect(put.status).toBe(200);
    expect(put.body.items[0].quantity).toBe(7);
    expect(put.body.subtotalCents).toBe(7 * MOUSE);

    const del = await request(app).delete(`/carts/${cart.id}/items/p_mouse`);
    expect(del.status).toBe(200);
    expect(del.body.items).toEqual([]);
    expect(del.body.subtotalCents).toBe(0);
  });

  it('returns 404 CART_ITEM_NOT_FOUND for an item that is not in the cart', async () => {
    const cart = await createCart();

    const del = await request(app).delete(`/carts/${cart.id}/items/p_mouse`);
    const put = await request(app).put(`/carts/${cart.id}/items/p_mouse`).send({ quantity: 1 });

    for (const res of [del, put]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CART_ITEM_NOT_FOUND');
    }
  });

  it('returns 409 INSUFFICIENT_STOCK when PUT exceeds stock and keeps the old quantity', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_headphones', quantity: 1 });

    const res = await request(app)
      .put(`/carts/${cart.id}/items/p_headphones`)
      .send({ quantity: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({
      productId: 'p_headphones',
      requested: 5,
      available: 3,
    });
    expect((await getCart(cart.id)).items[0]!.quantity).toBe(1);
  });
});

describe('GET /carts/:cartId', () => {
  it('prices items at the current product price', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_mouse', quantity: 2 });

    await pool.query(`UPDATE products SET price_cents = 12345 WHERE id = 'p_mouse'`);
    const after = await getCart(cart.id);

    expect(after.items[0]!.unitPriceCents).toBe(12345);
    expect(after.items[0]!.lineTotalCents).toBe(2 * 12345);
    expect(after.subtotalCents).toBe(2 * 12345);
  });

  it('reports inStock: false when stock drops below the cart quantity', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_headphones', quantity: 3 });

    await pool.query(`UPDATE products SET stock = 1 WHERE id = 'p_headphones'`);
    const after = await getCart(cart.id);

    expect(after.items[0]).toMatchObject({ quantity: 3, availableStock: 1, inStock: false });
  });
});

describe('closed carts', () => {
  it('returns 409 CART_NOT_OPEN for edits to a cart that is not open', async () => {
    const cart = await createCart();
    await addItem(cart.id, { productId: 'p_mouse', quantity: 1 });
    await pool.query(`UPDATE carts SET status = 'checked_out' WHERE id = $1`, [cart.id]);

    for (const res of [
      await addItem(cart.id, { productId: 'p_mouse', quantity: 1 }),
      await request(app).put(`/carts/${cart.id}/items/p_mouse`).send({ quantity: 2 }),
      await request(app).delete(`/carts/${cart.id}/items/p_mouse`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CART_NOT_OPEN');
    }
    expect((await getCart(cart.id)).status).toBe('checked_out');
  });
});
