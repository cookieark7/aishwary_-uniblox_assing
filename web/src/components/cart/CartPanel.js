import { Badge } from '../common/ui/Badge.js';
import { Button } from '../common/ui/Button.js';
import { Callout } from '../common/ui/Callout.js';
import { CopyButton } from '../common/ui/CopyButton.js';
import { EmptyState } from '../common/ui/EmptyState.js';
import { ErrorCallout } from '../common/ui/ErrorCallout.js';
import { SECTIONS } from '../../lib/constants/sections.js';
import { h } from '../../lib/utils/dom.js';
import { formatPaise, pluralize, shortId } from '../../lib/utils/format.js';
import { icon as Icon } from '../../lib/utils/icons.js';

/** @param {{ item: import('../../lib/types.js').CartItem, busy: boolean, onSet: Function, onRemove: Function }} props */
function CartLine({ item, busy, onSet, onRemove }) {
  return h(
    'li',
    { class: 'cart-line' },
    h(
      'div',
      { class: 'cart-line__main' },
      h('div', { class: 'cart-line__name' }, item.name),
      h(
        'div',
        { class: 'cart-line__meta' },
        `${formatPaise(item.unitPriceCents)} each`,
        item.inStock
          ? null
          : h(
              'span',
              null,
              ' · ',
              Badge({ text: `only ${item.availableStock} left`, tone: 'warning' }),
            ),
      ),
    ),
    h(
      'div',
      { class: 'stepper', role: 'group', 'aria-label': `Quantity of ${item.name}` },
      Button({
        label: 'Decrease',
        icon: 'minus',
        variant: 'ghost',
        size: 'sm',
        iconOnly: true,
        disabled: item.quantity <= 1,
        focusKey: `dec-${item.productId}`,
        onClick: () => onSet(item.productId, item.quantity - 1),
      }),
      h(
        'span',
        { class: 'stepper__value', 'aria-live': 'polite' },
        busy ? h('span', { class: 'spinner' }) : String(item.quantity),
      ),
      Button({
        label: 'Increase',
        icon: 'plus',
        variant: 'ghost',
        size: 'sm',
        iconOnly: true,
        focusKey: `inc-${item.productId}`,
        onClick: () => onSet(item.productId, item.quantity + 1),
      }),
    ),
    h('div', { class: 'cart-line__total' }, formatPaise(item.lineTotalCents)),
    Button({
      label: `Remove ${item.name}`,
      icon: 'trash',
      variant: 'ghost',
      size: 'sm',
      iconOnly: true,
      focusKey: `rm-${item.productId}`,
      onClick: () => onRemove(item.productId),
    }),
  );
}

/**
 * The server's cart view, as-is. Totals are never recomputed here.
 * @param {{ slice: any, onSet: Function, onRemove: Function, onDismissError: Function,
 *   onNewCart: Function }} props
 */
export function CartPanel({ slice, onSet, onRemove, onDismissError, onNewCart }) {
  const { cart, busy, error } = slice;

  const header = h(
    'div',
    { class: 'card__header' },
    Icon('cart'),
    h('div', { class: 'card__title' }, 'Cart'),
    cart ? CopyButton({ value: cart.id, display: shortId(cart.id), label: 'Copy cart id' }) : null,
    cart
      ? Badge({
          text: cart.status === 'open' ? 'open' : 'checked out',
          tone: cart.status === 'open' ? 'accent' : 'success',
        })
      : null,
  );

  let body;
  if (!cart) {
    body = EmptyState({
      icon: 'cart',
      title: 'No cart yet',
      text: h(
        'span',
        null,
        'Adding a product creates one with ',
        h('code', null, 'POST /carts'),
        '.',
      ),
    });
  } else if (cart.status === 'checked_out') {
    body = Callout({
      tone: 'success',
      icon: 'check',
      title: 'Checked out',
      text: h(
        'span',
        null,
        'This cart became order ',
        h('a', { href: SECTIONS.orders.route, class: 'mono' }, shortId(cart.orderId)),
        '. It can no longer be edited (409 CART_NOT_OPEN). Adding a product starts a new cart.',
      ),
      actions: Button({ label: 'New cart', icon: 'plus', size: 'sm', onClick: onNewCart }),
    });
  } else if (cart.items.length === 0) {
    body = EmptyState({
      icon: 'cart',
      title: 'Cart is empty',
      text: 'Add a product from the table.',
    });
  } else {
    body = h(
      'ul',
      { class: 'cart-lines' },
      cart.items.map((item) =>
        CartLine({ item, busy: Boolean(busy[item.productId]), onSet, onRemove }),
      ),
    );
  }

  const canCheckout = cart?.status === 'open' && cart.items.length > 0;
  const footer = cart
    ? h(
        'div',
        { class: 'cart-foot' },
        h(
          'dl',
          { class: 'kv' },
          h('dt', null, 'Items'),
          h('dd', null, pluralize(cart.itemCount, 'unit')),
          h('dt', { class: 'kv__total' }, 'Subtotal'),
          h('dd', { class: 'kv__total' }, formatPaise(cart.subtotalCents)),
        ),
        h(
          'a',
          {
            class: ['btn', 'btn--primary', { 'is-disabled': !canCheckout }],
            href: SECTIONS.checkout.route,
            'aria-disabled': canCheckout ? null : 'true',
            tabIndex: canCheckout ? 0 : -1,
          },
          'Go to checkout',
          Icon('arrowRight'),
        ),
        h(
          'p',
          { class: 'hint' },
          'Prices are the products’ current prices — the cart stores quantities only.',
        ),
      )
    : null;

  return h(
    'div',
    { class: ['card', 'cart'] },
    header,
    error
      ? h('div', { class: 'card__body' }, ErrorCallout({ error, onDismiss: onDismissError }))
      : null,
    h('div', { class: 'cart__body' }, body),
    footer,
  );
}
