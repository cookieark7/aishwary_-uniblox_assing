/**
 * The current cart. The server's cart view is the only source of truth: prices, line
 * totals and the subtotal are always shown as the API returned them, never recomputed.
 *
 * Stale responses: edits can't be cancelled (the server applies them anyway), so instead
 * - only the response to the *latest* edit is applied, and
 * - if edits overlapped, one GET after the last one settles shows the final state,
 *   whatever order the server processed them in.
 */
import { api } from '../api/endpoints.js';
import { readJson, writeJson } from '../utils/storage.js';
import { patch, store, toErrorState } from './store.js';

const CART_KEY = 'uniblox.cartId';

let latestSeq = 0;
let inFlight = 0;
let overlapped = false;

function setCart(cart) {
  writeJson(CART_KEY, cart ? cart.id : null);
  patch('cart', { cartId: cart ? cart.id : null, cart, error: null });
}

/** Re-opens the cart remembered by this browser, if the server still has it. */
export async function restoreCart() {
  const cartId = readJson(CART_KEY, null);
  if (!cartId) return;
  patch('cart', { cartId, isLoading: true });
  try {
    const { data } = await api.carts.get(cartId);
    setCart(data);
  } catch {
    setCart(null); // the database was reset, or the id is gone: start fresh
  } finally {
    patch('cart', { isLoading: false });
  }
}

export async function refreshCart() {
  const { cartId } = store.get().cart;
  if (!cartId) return;
  try {
    const { data } = await api.carts.get(cartId);
    patch('cart', { cart: data });
  } catch (err) {
    patch('cart', { error: toErrorState(err, 'refresh cart') });
  }
}

/** POST /carts. Used explicitly ("New cart") and lazily on the first add. */
export async function startNewCart() {
  patch('cart', { isLoading: true });
  try {
    const { data } = await api.carts.create();
    setCart(data);
    patch('checkout', { outcome: null });
    return data.id;
  } catch (err) {
    patch('cart', { error: toErrorState(err, 'create cart') });
    return null;
  } finally {
    patch('cart', { isLoading: false });
  }
}

async function ensureOpenCart() {
  const { cart } = store.get().cart;
  if (cart && cart.status === 'open') return cart.id;
  return startNewCart();
}

/** Runs one cart edit with latest-wins + overlap refresh, and a per-product busy flag. */
async function edit(productId, action, call) {
  const seq = ++latestSeq;
  inFlight += 1;
  if (inFlight > 1) overlapped = true;
  patch('cart', (slice) => ({
    busy: { ...slice.busy, [productId]: (slice.busy[productId] ?? 0) + 1 },
  }));

  try {
    const { data } = await call();
    if (seq === latestSeq) patch('cart', { cart: data, error: null });
  } catch (err) {
    patch('cart', { error: toErrorState(err, action) });
  } finally {
    inFlight -= 1;
    patch('cart', (slice) => {
      const busy = { ...slice.busy };
      busy[productId] -= 1;
      if (busy[productId] <= 0) delete busy[productId];
      return { busy };
    });
    if (inFlight === 0 && overlapped) {
      overlapped = false;
      await refreshCart();
    }
  }
}

export async function addItem(productId, quantity) {
  const cartId = await ensureOpenCart();
  if (!cartId) return;
  await edit(productId, `add ${productId}`, () => api.carts.addItem(cartId, productId, quantity));
}

export async function setQuantity(productId, quantity) {
  const { cartId } = store.get().cart;
  if (!cartId) return;
  await edit(productId, `set ${productId}`, () =>
    api.carts.setQuantity(cartId, productId, quantity),
  );
}

export async function removeItem(productId) {
  const { cartId } = store.get().cart;
  if (!cartId) return;
  await edit(productId, `remove ${productId}`, () => api.carts.removeItem(cartId, productId));
}

export function dismissCartError() {
  patch('cart', { error: null });
}
