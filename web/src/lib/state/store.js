/**
 * The single app store. State is replaced immutably, so a region can tell whether its
 * slice changed with a reference check (see utils/mount.js).
 *
 * Only *source* data lives here (what the server said, what is in flight). Anything that
 * can be computed from it — counts, "can check out", the checkout timeline — is derived
 * at render time and never stored, so it can never go stale.
 */
import { DEFAULT_SECTION } from '../constants/sections.js';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    /** @param {(s: any) => any} updater */
    set(updater) {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const store = createStore({
  route: DEFAULT_SECTION,
  health: { status: 'checking' },
  catalog: { products: [], isLoading: false, error: null },
  cart: { cartId: null, cart: null, isLoading: false, busy: {}, error: null },
  checkout: { isSubmitting: false, outcome: null },
  orders: { list: [], selectedId: null, byId: {}, isLoading: false, error: null },
  coupons: {
    list: [],
    milestone: null,
    isLoading: false,
    error: null,
    isGenerating: false,
    notice: null,
  },
  lab: { runs: {} },
  network: { entries: [], expandedId: null },
});

/** Shallow-merges `partial` (or `partial(slice)`) into one slice. */
export function patch(sliceKey, partial) {
  store.set((s) => ({
    ...s,
    [sliceKey]: {
      ...s[sliceKey],
      ...(typeof partial === 'function' ? partial(s[sliceKey]) : partial),
    },
  }));
}

/** Turns anything thrown into the plain error object the UI renders. */
export function toErrorState(err, action) {
  return {
    action,
    status: err?.status ?? 0,
    code: err?.code ?? 'NETWORK_ERROR',
    message: err?.message ?? 'Request failed',
    details: err?.details,
    at: Date.now(),
  };
}
