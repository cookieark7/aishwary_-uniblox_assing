import { Badge } from '../common/ui/Badge.js';
import { Button } from '../common/ui/Button.js';
import { CopyButton } from '../common/ui/CopyButton.js';
import { EmptyState } from '../common/ui/EmptyState.js';
import { h } from '../../lib/utils/dom.js';
import { formatRelativeTime, shortId } from '../../lib/utils/format.js';

/**
 * @param {{ list: import('../../lib/types.js').Coupon[], onUse: (code: string) => void,
 *   onOpenOrder: (orderId: string) => void }} props
 */
export function CouponTable({ list, onUse, onOpenOrder }) {
  if (list.length === 0) {
    return EmptyState({
      icon: 'ticket',
      title: 'No coupons yet',
      text: 'Place enough orders to reach a milestone, then generate one.',
    });
  }
  return h(
    'table',
    { class: 'table', 'aria-label': 'Coupons, newest first' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, 'Code'),
        h('th', { class: 'num' }, 'Milestone'),
        h('th', { class: 'num' }, 'Off'),
        h('th', null, 'Status'),
        h('th', null, 'Redeemed by'),
        h('th', null, h('span', { class: 'sr-only' }, 'Actions')),
      ),
    ),
    h(
      'tbody',
      null,
      list.map((c) =>
        h(
          'tr',
          null,
          h('td', null, CopyButton({ value: c.code, label: 'Copy code' })),
          h('td', { class: 'num' }, `#${c.milestone}`),
          h('td', { class: 'num' }, `${c.percentOff}%`),
          h(
            'td',
            null,
            Badge({
              text: c.status,
              tone: c.status === 'available' ? 'success' : 'neutral',
              title: c.redeemedAt
                ? `redeemed ${formatRelativeTime(c.redeemedAt)}`
                : `created ${formatRelativeTime(c.createdAt)}`,
            }),
          ),
          h(
            'td',
            null,
            c.redeemedOrderId
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: ['link', 'mono'],
                    onClick: () => onOpenOrder(c.redeemedOrderId),
                  },
                  `order ${shortId(c.redeemedOrderId)}`,
                )
              : h('span', { class: 'hint' }, '—'),
          ),
          h(
            'td',
            { class: 'num' },
            c.status === 'available'
              ? Button({
                  label: 'Use at checkout',
                  size: 'sm',
                  variant: 'ghost',
                  icon: 'arrowRight',
                  onClick: () => onUse(c.code),
                })
              : null,
          ),
        ),
      ),
    ),
  );
}
