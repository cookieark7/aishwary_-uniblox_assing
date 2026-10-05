/**
 * Layer 0 — the checkout transaction, step by step, exactly as the backend runs it
 * (src/checkout/checkout.service.ts). The timeline component renders this list.
 */
export const CHECKOUT_STEPS = [
  {
    key: 'close',
    title: 'Close the cart',
    lock: 'cart row',
    sql: "UPDATE carts SET status='checked_out' WHERE id=$1 AND status='open'",
    detail:
      'Locks the cart. A cart that was already checked out is a retry: the existing order is returned.',
  },
  {
    key: 'coupon',
    title: 'Claim the coupon',
    lock: 'coupon row',
    sql: "UPDATE coupons SET status='redeemed' WHERE code=$1 AND status='available'",
    detail: 'Only if a code was sent. A parallel checkout with the same code waits on this lock.',
  },
  {
    key: 'stock',
    title: 'Lock products, check & take stock',
    lock: 'product rows, by id',
    sql: 'SELECT … FROM cart_items JOIN products … ORDER BY p.id FOR UPDATE OF p',
    detail: 'Every short line is reported at once. Fixed lock order means no deadlocks.',
  },
  {
    key: 'totals',
    title: 'Compute totals',
    lock: null,
    sql: 'discount = floor(subtotal × percentOff / 100)',
    detail: 'Integer paise throughout. Flooring never gives more than the advertised percentage.',
  },
  {
    key: 'order',
    title: 'Write the order snapshot',
    lock: null,
    sql: 'INSERT INTO orders …; INSERT INTO order_items …',
    detail: 'Name and price are copied as they are now, then everything commits together.',
  },
];

/** @typedef {'done' | 'failed' | 'skipped' | 'replayed' | 'not-run' | 'idle'} StepState */
