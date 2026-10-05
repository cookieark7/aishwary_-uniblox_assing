import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/**
 * Notion-style callout block.
 * @param {{ tone?: 'neutral'|'success'|'error'|'warning', icon?: string, title?: any,
 *   text?: any, items?: any[], actions?: any, children?: any, role?: string }} props
 */
export function Callout({
  tone = 'neutral',
  icon = 'info',
  title,
  text,
  items,
  actions,
  children,
  role,
}) {
  return h(
    'div',
    { class: ['callout', tone !== 'neutral' && `callout--${tone}`], role },
    Icon(icon),
    h(
      'div',
      { class: 'callout__body' },
      title ? h('div', { class: 'callout__title' }, title) : null,
      text ? h('div', { class: 'callout__text' }, text) : null,
      items?.length
        ? h(
            'ul',
            null,
            items.map((item) => h('li', null, item)),
          )
        : null,
      children ?? null,
    ),
    actions ?? null,
  );
}
