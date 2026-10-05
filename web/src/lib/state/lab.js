/**
 * Race lab: each runner sets up its preconditions through the public API, fires a burst
 * of parallel requests, then re-reads the database (through the API) and checks the
 * invariant. Everything shows up in the network inspector under the scenario's label.
 */
import { api } from '../api/endpoints.js';
import { settle } from '../api/client.js';
import { LAB_SCENARIOS } from '../constants/lab-scenarios.js';
import { loadProducts } from './catalog.js';
import { loadCoupons } from './coupons.js';
import { rememberOrder } from './orders.js';
import { patch, store } from './store.js';

/**
 * @typedef {Object} Assertion
 * @property {string} label
 * @property {boolean} pass
 * @property {string} [detail]
 *
 * @typedef {Object} LabRun
 * @property {'running' | 'done' | 'blocked' | 'error'} status
 * @property {number} startedAt
 * @property {number} [ms]
 * @property {string} [summary]
 * @property {Array<{ label: string, status: number, code?: string, replayed?: boolean, note?: string }>} [responses]
 * @property {Assertion[]} [assertions]
 * @property {string} [message]
 */

class Blocked extends Error {}

function setRun(key, run) {
  patch('lab', (slice) => ({ runs: { ...slice.runs, [key]: run } }));
}

export async function runScenario(key) {
  const scenario = LAB_SCENARIOS.find((s) => s.key === key);
  if (!scenario || store.get().lab.runs[key]?.status === 'running') return;
  const startedAt = Date.now();
  setRun(key, { status: 'running', startedAt });
  try {
    const result = await RUNNERS[key](scenario.title);
    setRun(key, { status: 'done', startedAt, ms: Date.now() - startedAt, ...result });
  } catch (err) {
    setRun(key, {
      status: err instanceof Blocked ? 'blocked' : 'error',
      startedAt,
      message: err.message,
    });
  } finally {
    await Promise.all([loadProducts(), loadCoupons()]);
  }
}

/** Runs every scenario one after another (in parallel they would fight over stock). */
export async function runAll() {
  for (const scenario of LAB_SCENARIOS) await runScenario(scenario.key);
}

// ---------- helpers ----------

const products = async (group) => (await api.products.list({ group })).data;

async function cartWith(items, group) {
  const { data: cart } = await api.carts.create({ group });
  for (const [productId, quantity] of items) {
    await api.carts.addItem(cart.id, productId, quantity, { group });
  }
  return cart.id;
}

const label = (i) => `#${i + 1}`;
const count = (list, pred) => list.filter(pred).length;
const assert = (labelText, pass, detail) => ({ label: labelText, pass, detail });

function toChip(result, i) {
  return {
    label: label(i),
    status: result.status,
    code: result.ok ? undefined : result.code,
    replayed: result.replayed,
  };
}

// ---------- runners ----------

const RUNNERS = {
  /** 10 × "+1" on one cart, in parallel → quantity 10. */
  async concurrentAdds(title) {
    const setup = `${title} · setup`;
    const product = (await products(setup))
      .filter((p) => p.stock >= 10)
      .sort((a, b) => b.stock - a.stock)[0];
    if (!product) throw new Blocked('Needs a product with at least 10 in stock.');

    const { data: cart } = await api.carts.create({ group: setup });
    const burst = `${title} · 10 parallel POST /items`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        settle(api.carts.addItem(cart.id, product.id, 1, { group: burst })),
      ),
    );
    const { data: after } = await api.carts.get(cart.id, { group: `${title} · verify` });
    const quantity = after.items.find((i) => i.productId === product.id)?.quantity ?? 0;

    return {
      summary: `10 parallel adds of ${product.name} to cart ${cart.id.slice(0, 8)}`,
      responses: results.map(toChip),
      assertions: [
        assert('All 10 requests succeeded', count(results, (r) => r.status === 200) === 10),
        assert('Final quantity is exactly 10', quantity === 10, `got ${quantity}`),
      ],
    };
  },

  /** More carts than stock check out at once → exactly the stock sells. */
  async oversell(title) {
    const setup = `${title} · setup`;
    const product = (await products(setup))
      .filter((p) => p.stock > 0)
      .sort((a, b) => a.stock - b.stock)[0];
    if (!product)
      throw new Blocked('Everything is sold out. Reset the data with npm run db:setup.');

    // Keep the burst small: q units per cart, so at most 8 carts can succeed.
    const perCart = Math.max(1, Math.ceil(product.stock / 8));
    if (perCart > 100)
      throw new Blocked('Stock is too high for a quick demo (max 100 per cart line).');
    const canSucceed = Math.floor(product.stock / perCart);
    const carts = canSucceed + 3;
    const cartIds = await Promise.all(
      Array.from({ length: carts }, () => cartWith([[product.id, perCart]], setup)),
    );

    const burst = `${title} · ${carts} parallel checkouts`;
    const results = await Promise.all(
      cartIds.map((id) => settle(api.carts.checkout(id, undefined, { group: burst }))),
    );
    for (const r of results) if (r.ok) rememberOrder(r.data, 'race lab');

    const finalStock =
      (await products(`${title} · verify`)).find((p) => p.id === product.id)?.stock ?? NaN;
    const created = count(results, (r) => r.status === 201);
    const shortOnStock = count(results, (r) => r.code === 'INSUFFICIENT_STOCK');

    return {
      summary: `${product.name}: stock ${product.stock}, ${carts} carts × ${perCart} each`,
      responses: results.map(toChip),
      assertions: [
        assert(
          `Exactly ${canSucceed} checkouts succeeded`,
          created === canSucceed,
          `got ${created}`,
        ),
        assert(
          `The other ${carts - canSucceed} got 409 INSUFFICIENT_STOCK`,
          shortOnStock === carts - canSucceed,
          `got ${shortOnStock}`,
        ),
        assert(
          `Stock went ${product.stock} → ${product.stock - canSucceed * perCart}, never negative`,
          finalStock === product.stock - canSucceed * perCart,
          `now ${finalStock}`,
        ),
        assert(
          'No 5xx errors',
          results.every((r) => r.status < 500),
        ),
      ],
    };
  },

  /** One cart, checkout × 5 in parallel → 1 × 201 + 4 × 200 replays, one order. */
  async retryStorm(title) {
    const setup = `${title} · setup`;
    const before = await products(setup);
    const product = before
      .filter((p) => p.stock > 0)
      .sort((a, b) => a.priceCents - b.priceCents)[0];
    if (!product)
      throw new Blocked('Everything is sold out. Reset the data with npm run db:setup.');

    const cartId = await cartWith([[product.id, 1]], setup);
    const burst = `${title} · 5 parallel checkouts, same cart`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        settle(api.carts.checkout(cartId, undefined, { group: burst })),
      ),
    );
    const winner = results.find((r) => r.status === 201);
    if (winner) rememberOrder(winner.data, 'race lab');
    const orderIds = new Set(results.filter((r) => r.ok).map((r) => r.data.id));
    const finalStock =
      (await products(`${title} · verify`)).find((p) => p.id === product.id)?.stock ?? NaN;

    return {
      summary: `Cart ${cartId.slice(0, 8)} with 1 × ${product.name}`,
      responses: results.map((r, i) => ({
        ...toChip(r, i),
        note: r.ok ? `order ${r.data.id.slice(0, 8)}` : undefined,
      })),
      assertions: [
        assert('Exactly one 201 Created', count(results, (r) => r.status === 201) === 1),
        assert(
          'Four 200s with Idempotent-Replayed: true',
          count(results, (r) => r.status === 200 && r.replayed) === 4,
        ),
        assert('Every response carries the same order id', orderIds.size === 1),
        assert(
          `Stock decremented once (${product.stock} → ${product.stock - 1})`,
          finalStock === product.stock - 1,
          `now ${finalStock}`,
        ),
      ],
    };
  },

  /** Five carts redeem one coupon at once → exactly one wins. */
  async couponRace(title) {
    const setup = `${title} · setup`;
    const coupons = (await api.admin.coupons.list({ group: setup })).data;
    const coupon = coupons.find((c) => c.status === 'available');
    if (!coupon) {
      throw new Blocked('Needs an available coupon. Generate one on the Coupons page first.');
    }
    const product = (await products(setup))
      .filter((p) => p.stock >= 5)
      .sort((a, b) => a.priceCents - b.priceCents)[0];
    if (!product) throw new Blocked('Needs a product with at least 5 in stock.');

    const cartIds = await Promise.all(
      Array.from({ length: 5 }, () => cartWith([[product.id, 1]], setup)),
    );
    const burst = `${title} · 5 carts, code ${coupon.code}`;
    const results = await Promise.all(
      cartIds.map((id) => settle(api.carts.checkout(id, coupon.code, { group: burst }))),
    );
    const winner = results.find((r) => r.status === 201);
    if (winner) rememberOrder(winner.data, 'race lab');

    const verify = `${title} · verify`;
    const loserIds = cartIds.filter((_, i) => results[i].status !== 201);
    const loserCarts = await Promise.all(
      loserIds.map((id) => api.carts.get(id, { group: verify })),
    );
    const after = (await api.admin.coupons.list({ group: verify })).data.find(
      (c) => c.id === coupon.id,
    );

    return {
      summary: `${coupon.code} (${coupon.percentOff}% off) × 5 carts of 1 × ${product.name}`,
      responses: results.map(toChip),
      assertions: [
        assert(
          'Exactly one checkout won, with the discount applied',
          count(results, (r) => r.status === 201) === 1 && (winner?.data.discountCents ?? 0) > 0,
        ),
        assert(
          'Four got 409 COUPON_ALREADY_REDEEMED',
          count(results, (r) => r.code === 'COUPON_ALREADY_REDEEMED') === 4,
        ),
        assert(
          'The losing carts are still open (their checkout rolled back)',
          loserCarts.every(({ data }) => data.status === 'open'),
        ),
        assert(
          'The coupon is redeemed by the winning order',
          after?.status === 'redeemed' && after.redeemedOrderId === winner?.data.id,
        ),
      ],
    };
  },

  /** Five admins generate at once → at most one coupon for the milestone. */
  async generateRace(title) {
    const { data: before } = await api.admin.coupons.milestone({ group: `${title} · setup` });
    const burst = `${title} · 5 parallel POST /admin/coupons`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => settle(api.admin.coupons.generate({ group: burst }))),
    );
    const { data: after } = await api.admin.coupons.milestone({ group: `${title} · verify` });
    const expected = before.eligible ? 1 : 0;
    const created = count(results, (r) => r.status === 201);

    return {
      summary: before.eligible
        ? `Milestone ${before.nextMilestoneAt} is ready (${before.ordersPlaced} orders placed)`
        : `No milestone ready (${before.ordersPlaced}/${before.nextMilestoneAt} orders) — expect five 409s`,
      responses: results.map(toChip),
      assertions: [
        assert(`Exactly ${expected} coupon created`, created === expected, `got ${created}`),
        assert(
          'Every other request got a 409',
          count(results, (r) => r.status === 409) === 5 - expected,
        ),
        assert(
          `Coupons generated went ${before.couponsGenerated} → ${before.couponsGenerated + expected}`,
          after.couponsGenerated === before.couponsGenerated + expected,
          `now ${after.couponsGenerated}`,
        ),
      ],
    };
  },
};
