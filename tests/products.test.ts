import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { resetDb } from '../src/scripts/db-setup.js';

const app = createApp();

beforeEach(async () => {
  await resetDb(process.env.TEST_DATABASE_URL!);
});

afterAll(async () => {
  await pool.end();
});

describe('GET /products', () => {
  it('lists products in camelCase with integer minor units', async () => {
    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    expect(res.body).toContainEqual({
      id: 'p_mouse',
      name: 'Wireless Mouse',
      priceCents: 99900,
      stock: 100,
    });
  });
});
