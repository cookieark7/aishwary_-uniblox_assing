import { Badge } from '../common/ui/Badge.js';
import { Button } from '../common/ui/Button.js';
import { EmptyState } from '../common/ui/EmptyState.js';
import { JsonView } from '../common/ui/JsonView.js';
import { StatusChip } from '../common/ui/StatusChip.js';
import { clearLog, toggleEntry } from '../../lib/state/network.js';
import { fragment, h } from '../../lib/utils/dom.js';
import { formatMs, formatTime } from '../../lib/utils/format.js';
import { icon as Icon } from '../../lib/utils/icons.js';

/**
 * Ids already drawn once. The list is redrawn on every request, so only rows not seen
 * before get the entrance animation. Local UI state, deliberately outside the store.
 */
const seen = new Set();

/** @param {{ entry: import('../../lib/types.js').NetworkEntry, expanded: boolean }} props */
function NetworkEntry({ entry, expanded }) {
  const isNew = !seen.has(entry.id);
  seen.add(entry.id);
  const errorCode =
    entry.responseBody && typeof entry.responseBody === 'object' && 'error' in entry.responseBody
      ? entry.responseBody.error?.code
      : null;

  return h(
    'li',
    { class: ['net', { 'net--open': expanded, 'net--new': isNew }] },
    h(
      'button',
      {
        type: 'button',
        class: 'net__row',
        'aria-expanded': expanded ? 'true' : 'false',
        'data-focus-key': `net-${entry.id}`,
        onClick: () => toggleEntry(entry.id),
      },
      h('span', { class: ['method', `method--${entry.method}`] }, entry.method),
      h('span', { class: 'net__path', title: entry.path }, entry.path),
      entry.replayed
        ? Badge({ text: 'replayed', tone: 'accent', title: 'Idempotent-Replayed: true' })
        : null,
      errorCode ? h('span', { class: 'net__code' }, errorCode) : null,
      StatusChip({ status: entry.status }),
      h('span', { class: 'net__ms' }, entry.ms === null ? '' : formatMs(entry.ms)),
    ),
    expanded
      ? h(
          'div',
          { class: 'net__detail' },
          h(
            'div',
            { class: 'hint' },
            `${formatTime(entry.startedAt)}`,
            entry.replayed ? ' · response header Idempotent-Replayed: true' : '',
          ),
          entry.requestBody !== undefined
            ? fragment(
                h('div', { class: 'label' }, 'Request body'),
                JsonView({ value: entry.requestBody, label: 'Request body' }),
              )
            : h('div', { class: 'hint' }, 'No request body'),
          h('div', { class: 'label' }, 'Response'),
          entry.status === null
            ? h('div', { class: 'hint' }, 'In flight…')
            : JsonView({ value: entry.responseBody, label: 'Response body' }),
        )
      : null,
  );
}

/**
 * Every request the UI makes, newest first, grouped by what triggered it.
 * @param {{ network: { entries: import('../../lib/types.js').NetworkEntry[], expandedId: number | null } }} props
 */
export function NetworkInspector({ network }) {
  const { entries, expandedId } = network;
  const inFlight = entries.filter((e) => e.status === null).length;

  const rows = [];
  let lastGroup;
  for (const entry of entries) {
    if (entry.group !== lastGroup) {
      if (entry.group)
        rows.push(h('li', { class: 'net-group', 'aria-hidden': 'true' }, entry.group));
      lastGroup = entry.group;
    }
    rows.push(NetworkEntry({ entry, expanded: entry.id === expandedId }));
  }

  return fragment(
    h(
      'div',
      { class: 'inspector__head' },
      Icon('activity'),
      h('h2', { class: 'inspector__title' }, 'Network'),
      h(
        'span',
        { class: 'hint' },
        inFlight ? `${inFlight} in flight` : `${entries.length} requests`,
      ),
      Button({
        label: 'Clear',
        variant: 'ghost',
        size: 'sm',
        disabled: entries.length === 0,
        focusKey: 'net-clear',
        onClick: clearLog,
      }),
    ),
    entries.length === 0
      ? EmptyState({
          icon: 'activity',
          title: 'No requests yet',
          text: 'Every call this page makes appears here, with its status, error code and JSON.',
        })
      : h(
          'ol',
          { class: 'inspector__list', 'aria-label': 'Requests, newest first', 'aria-live': 'off' },
          rows,
        ),
  );
}
