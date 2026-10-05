import { Badge } from '../common/ui/Badge.js';
import { h } from '../../lib/utils/dom.js';
import { formatRelativeTime, shortId } from '../../lib/utils/format.js';

/**
 * Orders this browser created. A listbox: arrow keys move, Enter/Space selects.
 * @param {{ list: Array<{ id: string, source: string, at: number }>, selectedId: string | null,
 *   onSelect: (id: string) => void }} props
 */
export function OrderList({ list, selectedId, onSelect }) {
  const onKeyDown = (e) => {
    const index = list.findIndex((o) => o.id === selectedId);
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = list[Math.min(list.length - 1, Math.max(0, index + move))];
    if (next) onSelect(next.id);
  };

  return h(
    'ul',
    {
      class: 'order-list',
      role: 'listbox',
      'aria-label': 'Your orders',
      tabIndex: 0,
      'data-focus-key': 'order-list',
      'aria-activedescendant': selectedId ? `order-${selectedId}` : null,
      onKeyDown,
    },
    list.map((o) =>
      h(
        'li',
        {
          id: `order-${o.id}`,
          role: 'option',
          class: 'order-list__item',
          'aria-selected': o.id === selectedId ? 'true' : 'false',
          onClick: () => onSelect(o.id),
        },
        h('span', { class: 'mono' }, shortId(o.id)),
        Badge({ text: o.source, tone: o.source === 'checkout' ? 'neutral' : 'accent' }),
        h('span', { class: 'hint' }, formatRelativeTime(o.at)),
      ),
    ),
  );
}
