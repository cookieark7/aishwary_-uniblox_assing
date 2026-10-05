import { CouponField, getCouponDraft } from '../components/checkout/CouponField.js';
import { OutcomeBanner } from '../components/checkout/OutcomeBanner.js';
import { TransactionTimeline } from '../components/checkout/TransactionTimeline.js';
import { TopBar } from '../components/common/layout/TopBar.js';
import { Badge } from '../components/common/ui/Badge.js';
import { Button } from '../components/common/ui/Button.js';
import { Callout } from '../components/common/ui/Callout.js';
import { EmptyState } from '../components/common/ui/EmptyState.js';
import { OrderReceipt } from '../components/orders/OrderReceipt.js';
import { SECTIONS } from '../lib/constants/sections.js';
import { startNewCart } from '../lib/state/cart.js';
import { submitCheckout, timelineFor } from '../lib/state/checkout.js';
import { h } from '../lib/utils/dom.js';
import { formatPaise, pluralize, shortId } from '../lib/utils/format.js';

/** Read-only lines of the cart being checked out, at current prices. */
function Summary(cart) {
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'card__header' },
      h('div', { class: 'card__title' }, 'Cart ', h('span', { class: 'mono' }, shortId(cart.id))),
      Badge({
        text: cart.status === 'open' ? 'open' : 'checked out',
        tone: cart.status === 'open' ? 'accent' : 'success',
      }),
    ),
    cart.items.length === 0
      ? h('div', { class: 'card__body hint' }, 'Empty — checking out will answer 422 CART_EMPTY.')
      : h(
          'ul',
          { class: 'summary-lines' },
          cart.items.map((i) =>
            h(
              'li',
              null,
              h('span', null, `${i.quantity} × ${i.name}`),
              h('span', { class: 'num' }, formatPaise(i.lineTotalCents)),
            ),
          ),
        ),
    h(
      'div',
      { class: 'card__body' },
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, `Subtotal (${pluralize(cart.itemCount, 'unit')})`),
        h('dd', null, formatPaise(cart.subtotalCents)),
        h('dt', null, 'Discount'),
        h('dd', { class: 'hint' }, 'computed by the server'),
      ),
    ),
  );
}

export function CheckoutPage(state) {
  const { cart } = state.cart;
  const { outcome, isSubmitting } = state.checkout;
  const top = TopBar({ section: SECTIONS.checkout });

  if (!cart) {
    return [
      top,
      EmptyState({
        icon: 'cart',
        title: 'No cart to check out',
        text: 'Add something on the Shop page first.',
        action: h('a', { class: ['btn', 'btn--primary'], href: SECTIONS.shop.route }, 'Go to shop'),
      }),
    ];
  }

  const closed = cart.status === 'checked_out';
  const timeline = timelineFor(outcome);
  const rolledBack = outcome?.kind === 'error' && !timeline.rejectedBeforeTransaction;
  const available = state.coupons.list.filter((c) => c.status === 'available');
  const submit = () => submitCheckout(getCouponDraft());

  return [
    top,
    closed
      ? Callout({
          tone: 'neutral',
          icon: 'refresh',
          title: `This cart is already checked out (order ${shortId(cart.orderId)})`,
          text: 'Checking out again is a retry: the same coupon (or none) → 200 replay of the same order; a different coupon → 409 CART_ALREADY_CHECKED_OUT.',
          actions: Button({ label: 'New cart', icon: 'plus', size: 'sm', onClick: startNewCart }),
        })
      : null,
    h(
      'div',
      { class: 'checkout' },
      h(
        'div',
        { class: 'checkout__form' },
        Summary(cart),
        CouponField({ available, disabled: isSubmitting, onSubmit: submit }),
        h(
          'div',
          { class: 'checkout__actions' },
          Button({
            label: closed ? 'Retry checkout' : 'Place order',
            icon: closed ? 'refresh' : 'check',
            variant: 'primary',
            loading: isSubmitting,
            focusKey: 'place-order',
            onClick: submit,
          }),
          h('code', { class: 'hint' }, `POST /carts/${shortId(cart.id)}…/checkout`),
        ),
        outcome
          ? OutcomeBanner({
              outcome,
              rejectedBeforeTransaction: timeline.rejectedBeforeTransaction,
            })
          : null,
      ),
      TransactionTimeline({ timeline, rolledBack, replayed: outcome?.kind === 'replayed' }),
    ),
    outcome?.order ? OrderReceipt({ order: outcome.order }) : null,
  ];
}
