import { Badge } from '../common/ui/Badge.js';
import { CopyButton } from '../common/ui/CopyButton.js';
import { h } from '../../lib/utils/dom.js';
import { formatPaise, formatTime, shortId } from '../../lib/utils/format.js';
import { icon as Icon } from '../../lib/utils/icons.js';

/**
 * An order exactly as GET /orders/:id returns it — a snapshot of names and prices at
 * checkout time, read from orders + order_items only.
 * @param {{ order: import('../../lib/types.js').Order }} props
 */
export function OrderReceipt({ order }) {
  return h(
    'article',
    { class: ['card', 'receipt', 'table-scroll'], 'aria-label': `Order ${order.id}` },
    h(
      'div',
      { class: 'card__header' },
      Icon('package'),
      h('div', { class: 'card__title' }, 'Order ', h('span', { class: 'mono' }, shortId(order.id))),
      CopyButton({ value: order.id, display: 'copy id', label: 'Copy order id' }),
      h('span', { class: 'hint' }, formatTime(order.createdAt)),
    ),
    h(
      'table',
      { class: 'table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, 'Item (snapshot)'),
          h('th', { class: 'num' }, 'Unit'),
          h('th', { class: 'num' }, 'Qty'),
          h('th', { class: 'num' }, 'Line'),
        ),
      ),
      h(
        'tbody',
        null,
        order.items.map((item) =>
          h(
            'tr',
            null,
            h('td', null, item.name),
            h('td', { class: 'num' }, formatPaise(item.unitPriceCents)),
            h('td', { class: 'num' }, String(item.quantity)),
            h('td', { class: 'num' }, formatPaise(item.lineTotalCents)),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card__body' },
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, 'Subtotal'),
        h('dd', null, formatPaise(order.subtotalCents)),
        h(
          'dt',
          null,
          'Discount ',
          order.couponCode
            ? Badge({
                text: order.couponCode,
                icon: 'ticket',
                style: { color: 'var(--id-coupons)' },
              })
            : null,
        ),
        h(
          'dd',
          null,
          order.discountCents ? `− ${formatPaise(order.discountCents)}` : formatPaise(0),
        ),
        h('dt', { class: 'kv__total' }, 'Total'),
        h('dd', { class: 'kv__total' }, formatPaise(order.totalCents)),
      ),
      order.couponCode
        ? h(
            'p',
            { class: 'hint' },
            `floor(${order.subtotalCents} × percentOff / 100) = ${order.discountCents} paise — never more than the advertised percentage.`,
          )
        : null,
    ),
  );
}
