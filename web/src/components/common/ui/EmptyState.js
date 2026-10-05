import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/** @param {{ icon: string, title: string, text?: any, action?: any }} props */
export function EmptyState({ icon, title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    Icon(icon, { size: 20 }),
    h('div', { class: 'empty__title' }, title),
    text ? h('div', null, text) : null,
    action ?? null,
  );
}
