/**
 * Layer 0 — every backend endpoint, in one place (the API's equivalent of ROUTES).
 * Paths are built here only; components and state never write a URL by hand.
 * `opts` passes through `signal` (cancellation) and `group` (inspector label).
 */
import { request } from './client.js';

/** @typedef {{ signal?: AbortSignal, group?: string | null }} Opts */

const enc = encodeURIComponent;

export const api = {
  health: (/** @type {Opts} */ opts) => request('GET', '/health', opts),

  products: {
    /** @returns {Promise<{ data: import('../types.js').Product[] }>} */
    list: (opts) => request('GET', '/products', opts),
  },

  carts: {
    create: (opts) => request('POST', '/carts', opts),
    get: (cartId, opts) => request('GET', `/carts/${enc(cartId)}`, opts),
    addItem: (cartId, productId, quantity, opts) =>
      request('POST', `/carts/${enc(cartId)}/items`, { ...opts, body: { productId, quantity } }),
    setQuantity: (cartId, productId, quantity, opts) =>
      request('PUT', `/carts/${enc(cartId)}/items/${enc(productId)}`, {
        ...opts,
        body: { quantity },
      }),
    removeItem: (cartId, productId, opts) =>
      request('DELETE', `/carts/${enc(cartId)}/items/${enc(productId)}`, opts),
    /** No coupon → no body at all, exactly like a plain client would send. */
    checkout: (cartId, couponCode, opts) =>
      request('POST', `/carts/${enc(cartId)}/checkout`, {
        ...opts,
        body: couponCode === undefined ? undefined : { couponCode },
      }),
  },

  orders: {
    get: (orderId, opts) => request('GET', `/orders/${enc(orderId)}`, opts),
  },

  admin: {
    coupons: {
      list: (opts) => request('GET', '/admin/coupons', opts),
      milestone: (opts) => request('GET', '/admin/coupons/milestone', opts),
      generate: (opts) => request('POST', '/admin/coupons', opts),
    },
  },
};
