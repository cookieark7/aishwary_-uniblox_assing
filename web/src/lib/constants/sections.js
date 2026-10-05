/**
 * Layer 0 — the app's sections, one per stage of the backend flow (like CONTENT_TYPES).
 * Navigation, page headers and keyboard shortcuts are all generated from this object.
 */
export const SECTIONS = {
  shop: {
    key: 'shop',
    group: 'Flow',
    step: 1,
    label: 'Shop',
    title: 'Products & cart',
    route: '#/shop',
    icon: 'store',
    color: 'var(--id-shop)',
    muted: 'var(--id-shop-muted)',
    description: 'Browse live stock and build a cart. Carts store quantities, never prices.',
  },
  checkout: {
    key: 'checkout',
    group: 'Flow',
    step: 2,
    label: 'Checkout',
    title: 'Checkout',
    route: '#/checkout',
    icon: 'receipt',
    color: 'var(--id-checkout)',
    muted: 'var(--id-checkout-muted)',
    description: 'One transaction turns the cart into an order. Watch each step pass or roll back.',
  },
  orders: {
    key: 'orders',
    group: 'Flow',
    step: 3,
    label: 'Orders',
    title: 'Orders',
    route: '#/orders',
    icon: 'package',
    color: 'var(--id-orders)',
    muted: 'var(--id-orders-muted)',
    description: 'Orders are snapshots: names and prices as they were at checkout.',
  },
  coupons: {
    key: 'coupons',
    group: 'Admin',
    step: 4,
    label: 'Coupons',
    title: 'Coupons',
    route: '#/coupons',
    icon: 'ticket',
    color: 'var(--id-coupons)',
    muted: 'var(--id-coupons-muted)',
    description:
      'Every Nth order earns a coupon. An admin generates it; a checkout redeems it once.',
  },
  lab: {
    key: 'lab',
    group: 'Verify',
    step: 5,
    label: 'Race lab',
    title: 'Race lab',
    route: '#/lab',
    icon: 'flask',
    color: 'var(--id-lab)',
    muted: 'var(--id-lab-muted)',
    description:
      'Fire the same requests in parallel and check the invariants hold — live, against the real database.',
  },
};

/** @typedef {keyof typeof SECTIONS} SectionKey */

export const SECTION_LIST = Object.values(SECTIONS);
export const DEFAULT_SECTION = SECTIONS.shop.key;

/** '#/checkout' → 'checkout'; anything unknown → the default section. */
export function sectionFromHash(hash) {
  const key = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return key in SECTIONS ? key : DEFAULT_SECTION;
}
