/**
 * Layer 0 — Race lab scenarios: what each one proves and which mechanism makes it hold.
 * The runners live in lib/state/lab.js; this file is only the description.
 * Order matters for “Run all”: generation runs before the coupon race, which needs a coupon.
 */
export const LAB_SCENARIOS = [
  {
    key: 'concurrentAdds',
    title: 'Concurrent cart edits',
    invariant: '10 parallel “+1” requests on one cart end at quantity 10, never fewer.',
    mechanism: 'SELECT … FOR UPDATE on the cart row serialises edits; the upsert adds atomically.',
    consumesData: false,
  },
  {
    key: 'oversell',
    title: 'Oversell race',
    invariant: 'More carts than stock check out at once — exactly the available stock sells.',
    mechanism:
      'Product rows are locked FOR UPDATE in id order, and stock is re-checked under the lock.',
    consumesData: true,
  },
  {
    key: 'retryStorm',
    title: 'Retry storm (idempotency)',
    invariant: 'The same cart checked out 5× at once → one 201, four 200 replays, one order.',
    mechanism: 'The cart is the idempotency key: duplicates queue on its row lock, then replay.',
    consumesData: true,
  },
  {
    key: 'generateRace',
    title: 'Coupon generation race',
    invariant: 'Five admins generate at once → at most one coupon per milestone.',
    mechanism: 'UNIQUE(milestone) + ON CONFLICT DO NOTHING: the losers insert nothing.',
    consumesData: true,
  },
  {
    key: 'couponRace',
    title: 'Coupon race',
    invariant: 'Five carts use one coupon at once → exactly one wins; the others stay open.',
    mechanism:
      'The coupon UPDATE … WHERE status = ‘available’ locks the row; losers see ‘redeemed’.',
    consumesData: true,
  },
];
