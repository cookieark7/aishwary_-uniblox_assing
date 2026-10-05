/**
 * Checkout: submits the cart and records the outcome. The step-by-step timeline is
 * *derived* from that outcome (see timelineFor), never stored.
 */
import { api } from '../api/endpoints.js';
import { CHECKOUT_STEPS } from '../constants/checkout-steps.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { loadProducts } from './catalog.js';
import { refreshCart } from './cart.js';
import { loadCoupons } from './coupons.js';
import { rememberOrder } from './orders.js';
import { patch, store, toErrorState } from './store.js';

/**
 * @typedef {Object} CheckoutOutcome
 * @property {'created' | 'replayed' | 'error'} kind
 * @property {number} status
 * @property {string | undefined} couponSent      exactly what was sent, before server normalising
 * @property {import('../types.js').Order} [order]
 * @property {ReturnType<typeof toErrorState>} [error]
 * @property {number} at
 */

/**
 * POST /carts/:id/checkout. An empty coupon field sends no body at all; anything else
 * is sent as typed, so the server's trimming, upper-casing and validation are visible.
 */
export async function submitCheckout(couponDraft) {
  const { cartId } = store.get().cart;
  if (!cartId || store.get().checkout.isSubmitting) return;
  const couponSent = couponDraft === '' ? undefined : couponDraft;

  patch('checkout', { isSubmitting: true });
  /** @type {CheckoutOutcome} */
  let outcome;
  try {
    const res = await api.carts.checkout(cartId, couponSent);
    outcome = {
      kind: res.status === 200 ? 'replayed' : 'created',
      status: res.status,
      couponSent,
      order: res.data,
      at: Date.now(),
    };
    rememberOrder(res.data, 'checkout');
  } catch (err) {
    outcome = {
      kind: 'error',
      status: err?.status ?? 0,
      couponSent,
      error: toErrorState(err, 'checkout'),
      at: Date.now(),
    };
  }
  patch('checkout', { isSubmitting: false, outcome });
  // Stock, the cart's status and coupon state may all have changed (or been rolled back).
  await Promise.all([refreshCart(), loadProducts(), loadCoupons()]);
}

export function clearOutcome() {
  patch('checkout', { outcome: null });
}

/**
 * Derives each transaction step's state from an outcome.
 * @param {CheckoutOutcome | null} outcome
 * @returns {{ steps: Array<typeof CHECKOUT_STEPS[number] & { state: import('../constants/checkout-steps.js').StepState, note?: string }>, rejectedBeforeTransaction: boolean }}
 */
export function timelineFor(outcome) {
  if (!outcome) {
    return {
      steps: CHECKOUT_STEPS.map((s) => ({ ...s, state: 'idle' })),
      rejectedBeforeTransaction: false,
    };
  }

  if (outcome.kind === 'replayed') {
    return {
      rejectedBeforeTransaction: false,
      steps: CHECKOUT_STEPS.map((s, i) =>
        i === 0
          ? {
              ...s,
              state: 'replayed',
              note: 'Already checked out with the same options → existing order returned, nothing written.',
            }
          : { ...s, state: 'not-run' },
      ),
    };
  }

  const usedCoupon = outcome.couponSent !== undefined;
  if (outcome.kind === 'created') {
    return {
      rejectedBeforeTransaction: false,
      steps: CHECKOUT_STEPS.map((s) =>
        s.key === 'coupon' && !usedCoupon
          ? { ...s, state: 'skipped', note: 'No coupon code sent.' }
          : { ...s, state: 'done' },
      ),
    };
  }

  const code = outcome.error?.code;
  const failedAt = code ? ERROR_CODES[code]?.step : null;
  if (!failedAt || failedAt === 'request') {
    return {
      rejectedBeforeTransaction: true,
      steps: CHECKOUT_STEPS.map((s) => ({ ...s, state: 'not-run' })),
    };
  }
  const failedIndex = CHECKOUT_STEPS.findIndex((s) => s.key === failedAt);
  return {
    rejectedBeforeTransaction: false,
    steps: CHECKOUT_STEPS.map((s, i) => {
      if (i === failedIndex) return { ...s, state: 'failed', note: outcome.error?.message };
      if (i > failedIndex) return { ...s, state: 'not-run' };
      if (s.key === 'coupon' && !usedCoupon)
        return { ...s, state: 'skipped', note: 'No coupon code sent.' };
      return { ...s, state: 'done', note: 'Rolled back.' };
    }),
  };
}
