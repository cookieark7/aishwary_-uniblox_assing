/**
 * Entry point: binds the three regions to the store, wires routing and shortcuts, and
 * loads initial data. Layer order (imports only ever point down):
 *   lib/{utils,constants,api,types} → lib/state → components/common → components/<feature>
 *   → pages → main
 */
import { Sidebar } from './components/common/layout/Sidebar.js';
import { NetworkInspector } from './components/inspector/NetworkInspector.js';
import { SECTION_LIST, SECTIONS, sectionFromHash } from './lib/constants/sections.js';
import { refreshCart, restoreCart } from './lib/state/cart.js';
import { loadProducts } from './lib/state/catalog.js';
import { loadCoupons } from './lib/state/coupons.js';
import { checkHealth } from './lib/state/health.js';
import { collapseEntry, startRecording } from './lib/state/network.js';
import { restoreOrders, selectOrder } from './lib/state/orders.js';
import { store } from './lib/state/store.js';
import { h, isTypingTarget } from './lib/utils/dom.js';
import { mount } from './lib/utils/mount.js';
import { CheckoutPage } from './pages/CheckoutPage.js';
import { CouponsPage } from './pages/CouponsPage.js';
import { LabPage } from './pages/LabPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { ShopPage } from './pages/ShopPage.js';

const PAGES = {
  shop: ShopPage,
  checkout: CheckoutPage,
  orders: OrdersPage,
  coupons: CouponsPage,
  lab: LabPage,
};

// ---------- regions ----------

let lastRenderedRoute = null;

function renderPage(state) {
  const entering = state.route !== lastRenderedRoute;
  lastRenderedRoute = state.route;
  document.title = `${SECTIONS[state.route].label} · Uniblox Store`;
  return h(
    'div',
    { class: ['page__stack', { 'page__stack--enter': entering }] },
    PAGES[state.route](state),
  );
}

startRecording();

mount(
  document.getElementById('sidebar'),
  store,
  (s) => [s.route, s.health, s.cart, s.orders.list, s.coupons.list, s.lab],
  Sidebar,
);
mount(
  document.getElementById('view'),
  store,
  (s) => [s.route, s.catalog, s.cart, s.checkout, s.orders, s.coupons, s.lab],
  renderPage,
);
mount(
  document.getElementById('inspector'),
  store,
  (s) => [s.network],
  (s) => NetworkInspector({ network: s.network }),
);

// ---------- routing ----------

/** Fresh data whenever a page is entered, so what the reviewer sees is the server's now. */
function onEnter(route) {
  if (route === 'shop') loadProducts();
  if (route === 'checkout') {
    refreshCart();
    loadCoupons();
  }
  if (route === 'orders') {
    const { selectedId, list } = store.get().orders;
    const id = selectedId ?? list[0]?.id;
    if (id) selectOrder(id);
  }
  if (route === 'coupons') loadCoupons();
}

function syncRoute() {
  const route = sectionFromHash(location.hash);
  if (route !== store.get().route) {
    store.set((s) => ({ ...s, route }));
    window.scrollTo({ top: 0 });
  }
  onEnter(route);
}

window.addEventListener('hashchange', syncRoute);

// ---------- keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    collapseEntry();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
  const section = SECTION_LIST.find((s) => String(s.step) === e.key);
  if (section) {
    e.preventDefault();
    location.hash = section.route;
  }
});

// ---------- boot ----------

if (!location.hash) history.replaceState(null, '', SECTIONS.shop.route);
restoreOrders();
restoreCart();
checkHealth();
loadCoupons();
syncRoute();
