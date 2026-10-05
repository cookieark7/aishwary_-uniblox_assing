import { TopBar } from '../components/common/layout/TopBar.js';
import { Button } from '../components/common/ui/Button.js';
import { Callout } from '../components/common/ui/Callout.js';
import { EmptyState } from '../components/common/ui/EmptyState.js';
import { ErrorCallout } from '../components/common/ui/ErrorCallout.js';
import { Spinner } from '../components/common/ui/Spinner.js';
import { OrderList } from '../components/orders/OrderList.js';
import { OrderReceipt } from '../components/orders/OrderReceipt.js';
import { SECTIONS } from '../lib/constants/sections.js';
import { forgetOrders, selectOrder } from '../lib/state/orders.js';
import { h } from '../lib/utils/dom.js';

export function OrdersPage(state) {
  const { list, selectedId, byId, isLoading, error } = state.orders;
  const selected = selectedId ? byId[selectedId] : null;

  const top = TopBar({
    section: SECTIONS.orders,
    actions: list.length
      ? Button({ label: 'Forget list', variant: 'ghost', icon: 'trash', onClick: forgetOrders })
      : null,
  });

  if (list.length === 0 && !selectedId) {
    return [
      top,
      EmptyState({
        icon: 'package',
        title: 'No orders from this browser yet',
        text: 'Check out a cart, or run a Race lab scenario.',
        action: h(
          'a',
          { class: ['btn', 'btn--primary'], href: SECTIONS.checkout.route },
          'Go to checkout',
        ),
      }),
    ];
  }

  return [
    top,
    Callout({
      icon: 'info',
      title: 'Snapshots',
      text: 'Each receipt is re-read from GET /orders/:id, which reads only orders + order_items. Names and prices are copies from checkout time, so later product changes never alter them.',
    }),
    h(
      'div',
      { class: 'orders' },
      list.length ? OrderList({ list, selectedId, onSelect: selectOrder }) : h('div'),
      h(
        'div',
        null,
        error
          ? ErrorCallout({ error })
          : selected
            ? OrderReceipt({ order: selected })
            : isLoading
              ? h('div', { class: 'empty' }, Spinner({ label: 'Loading order' }))
              : EmptyState({ icon: 'package', title: 'Pick an order' }),
      ),
    ),
  ];
}
