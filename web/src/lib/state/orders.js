/** Orders placed from this browser (remembered locally) and their server snapshots. */
import { api } from '../api/endpoints.js';
import { readJson, writeJson } from '../utils/storage.js';
import { patch, store, toErrorState } from './store.js';

const ORDERS_KEY = 'uniblox.orders';

export function restoreOrders() {
  const list = readJson(ORDERS_KEY, []);
  if (Array.isArray(list) && list.length > 0) {
    patch('orders', { list, selectedId: list[0].id });
  }
}

/**
 * Remembers an order this browser created and caches its body.
 * @param {import('../types.js').Order} order
 * @param {'checkout' | 'race lab'} source
 */
export function rememberOrder(order, source) {
  patch('orders', (slice) => {
    const known = slice.list.some((o) => o.id === order.id);
    const list = known
      ? slice.list
      : [{ id: order.id, source, at: Date.now() }, ...slice.list].slice(0, 50);
    writeJson(ORDERS_KEY, list);
    return { list, byId: { ...slice.byId, [order.id]: order } };
  });
}

/** Shows an order, always re-reading it from GET /orders/:id (the snapshot). */
export async function selectOrder(orderId) {
  patch('orders', { selectedId: orderId, isLoading: true, error: null });
  try {
    const { data } = await api.orders.get(orderId);
    patch('orders', (slice) => ({ byId: { ...slice.byId, [orderId]: data }, isLoading: false }));
  } catch (err) {
    patch('orders', { isLoading: false, error: toErrorState(err, 'load order') });
  }
}

export function forgetOrders() {
  writeJson(ORDERS_KEY, null);
  patch('orders', { list: [], selectedId: null, byId: {}, error: null });
}

export function selectedOrder() {
  const { selectedId, byId } = store.get().orders;
  return selectedId ? (byId[selectedId] ?? null) : null;
}
