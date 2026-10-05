import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { generateCouponCode } from '../src/coupons/coupons.service.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from '../src/scripts/db-setup.js';

const app = createApp();
const CODE_PATTERN = /^SAVE-[A-Z2-9]{8}$/;

beforeEach(async () => {
  await resetDb(process.env.TEST_DATABASE_URL!);
});

afterAll(async () => {
  await pool.end();
});

/** Creates `k` carts with 1 p_cable each and checks them all out. */
async function placeOrders(k: number): Promise<void> {
  await Promise.all(
    Array.from({ length: k }, async () => {
      const cart = await request(app).post('/carts');
      expect(cart.status).toBe(201);
      const add = await request(app)
        .post(`/carts/${cart.body.id}/items`)
        .send({ productId: 'p_cable', quantity: 1 });
      expect(add.status).toBe(200);
      const checkout = await request(app).post(`/carts/${cart.body.id}/checkout`);
      expect(checkout.status).toBe(201);
    }),
  );
}

function generate() {
  return request(app).post('/admin/coupons');
}

async function couponCount(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM coupons');
  return rows[0]!.n;
}

describe('POST /admin/coupons', () => {
  it('runs with N = 3 and 10% off (set in tests/setup.ts)', () => {
    expect(config.COUPON_EVERY_N_ORDERS).toBe(3);
    expect(config.COUPON_PERCENT_OFF).toBe(10);
  });

  it('1. 0 orders -> 409 NO_ELIGIBLE_MILESTONE, next milestone at 3', async () => {
    const res = await generate();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ELIGIBLE_MILESTONE');
    expect(res.body.error.details).toEqual({ ordersPlaced: 0, nextMilestoneAt: 3 });
    expect(await couponCount()).toBe(0);
  });

  it('2. 3 orders -> 201 for milestone 3; calling again -> 409, next milestone at 6', async () => {
    await placeOrders(3);

    const res = await generate();

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      code: expect.stringMatching(CODE_PATTERN),
      milestone: 3,
      percentOff: 10,
      status: 'available',
      createdAt: expect.any(String),
    });

    const again = await generate();
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NO_ELIGIBLE_MILESTONE');
    expect(again.body.error.details).toEqual({ ordersPlaced: 3, nextMilestoneAt: 6 });
    expect(await couponCount()).toBe(1);
  });

  it('3. missed milestones accumulate: 6 orders -> milestones 3 and 6, then 409', async () => {
    await placeOrders(6);

    const first = await generate();
    const second = await generate();
    const third = await generate();

    expect(first.status).toBe(201);
    expect(first.body.milestone).toBe(3);
    expect(second.status).toBe(201);
    expect(second.body.milestone).toBe(6);
    expect(third.status).toBe(409);
    expect(third.body.error.details).toEqual({ ordersPlaced: 6, nextMilestoneAt: 9 });
  });

  it('4. GENERATE RACE: 5 parallel requests at one milestone -> one 201, four 409', async () => {
    await placeOrders(3);

    const responses = await Promise.all(Array.from({ length: 5 }, () => generate()));

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    // A loser either collided on the milestone's unique index (COUPON_ALREADY_GENERATED),
    // or started after the winner committed and so saw no eligible milestone.
    for (const r of rejected) {
      expect(['COUPON_ALREADY_GENERATED', 'NO_ELIGIBLE_MILESTONE']).toContain(r.body.error.code);
    }
    expect(await couponCount()).toBe(1);
  });

  it('5. codes look like SAVE-XXXXXXXX using A-Z and 2-9', async () => {
    await placeOrders(6);
    const codes = [(await generate()).body.code, (await generate()).body.code];

    for (const code of codes) expect(code).toMatch(CODE_PATTERN);
    expect(new Set(codes).size).toBe(2);

    for (let i = 0; i < 1000; i++) expect(generateCouponCode()).toMatch(CODE_PATTERN);
  });

  it('rejects a request body', async () => {
    const res = await generate().send({ milestone: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /admin/coupons/milestone', () => {
  it('reports progress towards the next coupon without creating one', async () => {
    const empty = await request(app).get('/admin/coupons/milestone');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      everyNOrders: 3,
      percentOff: 10,
      ordersPlaced: 0,
      couponsGenerated: 0,
      nextMilestoneAt: 3,
      eligible: false,
    });

    await placeOrders(3);
    const ready = await request(app).get('/admin/coupons/milestone');
    expect(ready.body).toMatchObject({ ordersPlaced: 3, nextMilestoneAt: 3, eligible: true });
    expect(await couponCount()).toBe(0);

    await generate();
    const after = await request(app).get('/admin/coupons/milestone');
    expect(after.body).toMatchObject({ couponsGenerated: 1, nextMilestoneAt: 6, eligible: false });
  });
});

describe('GET /admin/coupons', () => {
  it('lists coupons newest first with status and redeemedOrderId', async () => {
    await placeOrders(6);
    await generate();
    await generate();

    const res = await request(app).get('/admin/coupons');

    expect(res.status).toBe(200);
    expect(res.body.map((c: { milestone: number }) => c.milestone)).toEqual([6, 3]);
    for (const coupon of res.body) {
      expect(coupon).toMatchObject({
        percentOff: 10,
        status: 'available',
        redeemedAt: null,
        redeemedOrderId: null,
      });
    }
  });

  it('returns an empty list when no coupons exist', async () => {
    const res = await request(app).get('/admin/coupons');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
