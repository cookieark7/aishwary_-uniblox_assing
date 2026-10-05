/**
 * Layer 0 — every error code the API can return, in plain words, plus the checkout step
 * it comes from (so the timeline can mark where the transaction stopped).
 * `step: 'request'` means it was rejected before any transaction started.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: {
    step: 'request',
    explain: 'The request was rejected by zod validation before touching the database.',
  },
  INVALID_JSON: { step: 'request', explain: 'The body was not valid JSON.' },
  NOT_FOUND: { step: 'request', explain: 'No such route.' },
  CART_NOT_FOUND: { step: 'close', explain: 'No cart with that id exists.' },
  CART_NOT_OPEN: {
    step: null,
    explain: 'The cart is checked out, so it can no longer be edited.',
  },
  CART_ALREADY_CHECKED_OUT: {
    step: 'close',
    explain:
      'This cart was already checked out with different options (e.g. another coupon), so it is not a retry.',
  },
  CART_ITEM_NOT_FOUND: { step: null, explain: 'That product is not in the cart.' },
  PRODUCT_NOT_FOUND: { step: null, explain: 'No product with that id exists.' },
  INSUFFICIENT_STOCK: {
    step: 'stock',
    explain: 'Not enough stock. Nothing was reserved or changed.',
  },
  CART_EMPTY: { step: 'stock', explain: 'There is nothing in the cart to check out.' },
  COUPON_INVALID: { step: 'coupon', explain: 'No coupon has that code.' },
  COUPON_ALREADY_REDEEMED: {
    step: 'coupon',
    explain: 'That coupon was already used by another order. Each coupon works once.',
  },
  NO_ELIGIBLE_MILESTONE: {
    step: null,
    explain: 'Not enough orders yet for the next coupon.',
  },
  COUPON_ALREADY_GENERATED: {
    step: null,
    explain: 'Another request generated this milestone’s coupon a moment ago.',
  },
  DB_UNAVAILABLE: { step: null, explain: 'The server cannot reach the database.' },
  INTERNAL_ERROR: { step: null, explain: 'Unexpected server error (details are only logged).' },
  NETWORK_ERROR: { step: 'request', explain: 'The request never reached the server.' },
};

export function explainError(code) {
  return ERROR_CODES[code]?.explain ?? 'Unexpected error.';
}
