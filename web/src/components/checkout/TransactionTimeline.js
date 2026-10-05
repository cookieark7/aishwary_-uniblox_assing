import { Badge } from '../common/ui/Badge.js';
import { h } from '../../lib/utils/dom.js';
import { icon as Icon } from '../../lib/utils/icons.js';

const STATE_UI = {
  idle: { icon: null, label: 'Waiting' },
  done: { icon: 'check', label: 'Done' },
  failed: { icon: 'x', label: 'Failed here' },
  skipped: { icon: 'minus', label: 'Skipped' },
  replayed: { icon: 'refresh', label: 'Replayed' },
  'not-run': { icon: null, label: 'Not run' },
};

/**
 * The checkout transaction as a vertical timeline. Step states come from
 * `timelineFor(outcome)` — derived, never stored.
 * @param {{ timeline: ReturnType<typeof import('../../lib/state/checkout.js').timelineFor>,
 *   rolledBack: boolean, replayed?: boolean }} props
 */
export function TransactionTimeline({ timeline, rolledBack, replayed = false }) {
  return h(
    'div',
    { class: ['timeline', { 'timeline--rolled-back': rolledBack }] },
    h(
      'div',
      { class: 'timeline__head' },
      h('span', { class: 'label' }, 'BEGIN'),
      h('span', { class: 'timeline__hint' }, 'one transaction, one connection'),
    ),
    h(
      'ol',
      { class: 'timeline__steps' },
      timeline.steps.map((step, i) => {
        const ui = STATE_UI[step.state];
        return h(
          'li',
          { class: ['step', `step--${step.state}`], 'aria-label': `${step.title}: ${ui.label}` },
          h(
            'span',
            { class: 'step__marker', 'aria-hidden': 'true' },
            ui.icon ? Icon(ui.icon, { size: 12 }) : String.fromCharCode(97 + i),
          ),
          h(
            'div',
            { class: 'step__body' },
            h(
              'div',
              { class: 'step__title' },
              h('span', null, step.title),
              step.lock ? Badge({ text: step.lock, icon: 'lock' }) : null,
              step.state !== 'idle' ? h('span', { class: 'step__state' }, ui.label) : null,
            ),
            h('code', { class: 'step__sql' }, step.sql),
            h('div', { class: 'step__detail' }, step.note ?? step.detail),
          ),
        );
      }),
    ),
    h(
      'div',
      { class: 'timeline__head' },
      h(
        'span',
        { class: ['label', rolledBack ? 'timeline__rollback' : ''] },
        rolledBack ? 'ROLLBACK' : 'COMMIT',
      ),
      h(
        'span',
        { class: 'timeline__hint' },
        rolledBack
          ? 'every write above was undone: cart reopened, coupon released, stock untouched'
          : replayed
            ? 'nothing to write — a read-only replay of the existing order'
            : 'cart, coupon, stock and order become visible together',
      ),
    ),
  );
}
