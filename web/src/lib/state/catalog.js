/** Products with live stock. */
import { api } from '../api/endpoints.js';
import { patch, toErrorState } from './store.js';

let controller = null;

/**
 * (Re)loads products. A newer load aborts the older one, so a slow, stale response can
 * never overwrite fresher stock numbers.
 */
export async function loadProducts() {
  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  patch('catalog', { isLoading: true });
  try {
    const { data } = await api.products.list({ signal: mine.signal });
    patch('catalog', { products: data, isLoading: false, error: null });
  } catch (err) {
    if (mine.signal.aborted) return; // superseded by a newer load
    patch('catalog', { isLoading: false, error: toErrorState(err, 'load products') });
  } finally {
    if (controller === mine) controller = null;
  }
}
