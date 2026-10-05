import { Badge } from '../common/ui/Badge.js';
import { Button } from '../common/ui/Button.js';
import { EmptyState } from '../common/ui/EmptyState.js';
import { Spinner } from '../common/ui/Spinner.js';
import { h } from '../../lib/utils/dom.js';
import { formatPaise } from '../../lib/utils/format.js';

/**
 * Typed-but-not-yet-added quantities. Local UI state: it must survive re-renders but is
 * not app state, so it lives here instead of the store.
 * @type {Map<string, string>}
 */
const qtyDrafts = new Map();

function StockCell(stock) {
  return h(
    'td',
    { class: 'num' },
    stock === 0
      ? Badge({ text: 'Sold out', tone: 'error' })
      : stock <= 5
        ? h('span', null, Badge({ text: 'Low', tone: 'warning' }), ' ', String(stock))
        : String(stock),
  );
}

/**
 * The catalog with live stock. Quantities are sent exactly as typed: validation
 * (integer 1–100) is the server's job, and its 400 shows up in the cart panel.
 * @param {{ products: import('../../lib/types.js').Product[], isLoading: boolean,
 *   cart: import('../../lib/types.js').Cart | null, busy: Record<string, number>,
 *   onAdd: (productId: string, quantity: number) => void }} props
 */
export function ProductTable({ products, isLoading, cart, busy, onAdd }) {
  if (products.length === 0) {
    return isLoading
      ? h('div', { class: 'empty' }, Spinner({ label: 'Loading products' }))
      : EmptyState({
          icon: 'store',
          title: 'No products',
          text: 'Run npm run db:setup to seed them.',
        });
  }

  const inCart = new Map(
    cart?.status === 'open' ? cart.items.map((i) => [i.productId, i.quantity]) : [],
  );

  return h(
    'table',
    { class: 'table', 'aria-label': 'Products' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', null, 'Product'),
        h('th', { class: 'num' }, 'Price'),
        h('th', { class: 'num' }, 'Stock'),
        h('th', { class: 'num' }, 'In cart'),
        h('th', { class: 'num' }, h('span', { class: 'sr-only' }, 'Add to cart')),
      ),
    ),
    h(
      'tbody',
      null,
      products.map((p) => {
        const draft = qtyDrafts.get(p.id) ?? '1';
        const input = h('input', {
          class: ['input', 'input--qty'],
          type: 'number',
          inputmode: 'numeric',
          value: draft,
          'aria-label': `Quantity of ${p.name}`,
          'data-focus-key': `qty-${p.id}`,
          onInput: (e) => qtyDrafts.set(p.id, e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') add();
          },
        });
        // Number('') is 0 and Number('1.5') is 1.5 — both go to the server to be rejected.
        const add = () => onAdd(p.id, input.value === '' ? NaN : Number(input.value));
        return h(
          'tr',
          null,
          h(
            'td',
            null,
            h('div', null, p.name),
            h('div', { class: 'mono', style: { color: 'var(--text-tertiary)' } }, p.id),
          ),
          h('td', { class: 'num' }, formatPaise(p.priceCents)),
          StockCell(p.stock),
          h('td', { class: 'num' }, inCart.has(p.id) ? String(inCart.get(p.id)) : '—'),
          h(
            'td',
            { class: 'num' },
            h(
              'div',
              { class: 'add-cell' },
              input,
              Button({
                label: 'Add',
                icon: 'plus',
                size: 'sm',
                loading: Boolean(busy[p.id]),
                focusKey: `add-${p.id}`,
                ariaLabel: `Add ${p.name} to cart`,
                onClick: add,
              }),
            ),
          ),
        );
      }),
    ),
  );
}
