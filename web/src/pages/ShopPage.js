import { CartPanel } from '../components/cart/CartPanel.js';
import { ProductTable } from '../components/catalog/ProductTable.js';
import { TopBar } from '../components/common/layout/TopBar.js';
import { Button } from '../components/common/ui/Button.js';
import { Callout } from '../components/common/ui/Callout.js';
import { ErrorCallout } from '../components/common/ui/ErrorCallout.js';
import { SECTIONS } from '../lib/constants/sections.js';
import { loadProducts } from '../lib/state/catalog.js';
import {
  addItem,
  dismissCartError,
  removeItem,
  setQuantity,
  startNewCart,
} from '../lib/state/cart.js';
import { h } from '../lib/utils/dom.js';

export function ShopPage(state) {
  const { catalog, cart } = state;
  return [
    TopBar({
      section: SECTIONS.shop,
      actions: Button({
        label: 'Refresh stock',
        icon: 'refresh',
        variant: 'ghost',
        loading: catalog.isLoading,
        focusKey: 'refresh-stock',
        onClick: loadProducts,
      }),
    }),
    Callout({
      icon: 'info',
      title: 'What to watch',
      items: [
        h(
          'span',
          null,
          'Every edit is one transaction that first locks the cart row (',
          h('code', null, 'SELECT … FOR UPDATE'),
          ').',
        ),
        'Quantities are validated by the server: try 0, 101 or 1.5 and see the 400 VALIDATION_ERROR.',
        'Asking for more than is in stock gives 409 INSUFFICIENT_STOCK. It is only a soft check — nothing is reserved until checkout.',
      ],
    }),
    catalog.error ? ErrorCallout({ error: catalog.error }) : null,
    h(
      'div',
      { class: 'shop' },
      h(
        'div',
        { class: ['card', 'table-scroll'] },
        ProductTable({
          products: catalog.products,
          isLoading: catalog.isLoading,
          cart: cart.cart,
          busy: cart.busy,
          onAdd: addItem,
        }),
      ),
      CartPanel({
        slice: cart,
        onSet: setQuantity,
        onRemove: removeItem,
        onDismissError: dismissCartError,
        onNewCart: startNewCart,
      }),
    ),
  ];
}
