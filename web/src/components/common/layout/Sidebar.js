import { SECTION_LIST } from '../../../lib/constants/sections.js';
import { startNewCart } from '../../../lib/state/cart.js';
import { fragment, h } from '../../../lib/utils/dom.js';
import { shortId } from '../../../lib/utils/format.js';
import { icon as Icon } from '../../../lib/utils/icons.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Kbd } from '../ui/Kbd.js';

const HEALTH = {
  checking: { dot: '', text: 'Checking API…' },
  ok: { dot: 'dot--ok', text: 'API & database ok' },
  down: { dot: 'dot--down', text: 'API unreachable' },
};

/** Per-section counter, derived from state at render time. */
function countFor(key, state) {
  switch (key) {
    case 'shop':
      return state.cart.cart?.status === 'open' ? state.cart.cart.itemCount || null : null;
    case 'orders':
      return state.orders.list.length || null;
    case 'coupons':
      return state.coupons.list.filter((c) => c.status === 'available').length || null;
    case 'lab': {
      const runs = Object.values(state.lab.runs).filter((r) => r.status === 'done');
      if (runs.length === 0) return null;
      const passed = runs.filter((r) => r.assertions.every((a) => a.pass)).length;
      return `${passed}/${runs.length}`;
    }
    default:
      return null;
  }
}

function NavItem(section, state) {
  const active = state.route === section.key;
  const count = countFor(section.key, state);
  return h(
    'a',
    {
      class: 'nav__item',
      href: section.route,
      'aria-current': active ? 'page' : null,
      style: { '--section-color': section.color },
      'aria-keyshortcuts': String(section.step),
    },
    Icon(section.icon),
    h('span', { class: 'nav__text' }, section.label),
    count !== null ? h('span', { class: 'nav__count' }, String(count)) : null,
  );
}

function SessionBox(state) {
  const { cart, isLoading } = state.cart;
  return h(
    'div',
    { class: 'session', 'aria-label': 'This browser session' },
    h('div', { class: 'label' }, 'Session'),
    h(
      'div',
      { class: 'session__row' },
      h('span', null, 'Cart'),
      cart
        ? h(
            'span',
            null,
            h('span', { class: 'mono' }, shortId(cart.id)),
            ' ',
            Badge({
              text: cart.status === 'open' ? 'open' : 'checked out',
              tone: cart.status === 'open' ? 'accent' : 'success',
            }),
          )
        : h('span', null, 'none yet'),
    ),
    Button({
      label: 'New cart',
      icon: 'plus',
      variant: 'secondary',
      size: 'sm',
      loading: isLoading,
      focusKey: 'sidebar-new-cart',
      onClick: () => startNewCart(),
    }),
  );
}

export function Sidebar(state) {
  const health = HEALTH[state.health.status] ?? HEALTH.checking;
  const groups = [...new Set(SECTION_LIST.map((s) => s.group))];

  // Rendered into <nav id="sidebar" aria-label="Main"> (index.html).
  return fragment(
    h(
      'div',
      { class: 'sidebar__brand' },
      h('span', { class: 'sidebar__mark', 'aria-hidden': 'true' }, 'U'),
      h('span', { class: 'sidebar__name' }, 'Uniblox Store'),
    ),
    h(
      'div',
      { class: 'sidebar__health', role: 'status' },
      h('span', { class: ['dot', health.dot] }),
      health.text,
    ),
    h(
      'div',
      { class: 'nav-groups' },
      groups.map((group) =>
        h(
          'div',
          { class: 'nav' },
          h('div', { class: ['nav__label', 'label'] }, group),
          SECTION_LIST.filter((s) => s.group === group).map((s) => NavItem(s, state)),
        ),
      ),
    ),
    SessionBox(state),
    h(
      'div',
      { class: 'sidebar__hint' },
      Kbd('1'),
      '–',
      Kbd('5'),
      ' switch pages · ',
      Kbd('Esc'),
      ' closes details',
    ),
  );
}
