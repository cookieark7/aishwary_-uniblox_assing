import { h } from '../../lib/utils/dom.js';
import { pluralize } from '../../lib/utils/format.js';

/**
 * Progress towards the next coupon, from GET /admin/coupons/milestone.
 * Everything shown is derived from the five numbers the server returns.
 * @param {{ milestone: import('../../lib/types.js').Milestone }} props
 */
export function MilestoneProgress({ milestone }) {
  const {
    everyNOrders: n,
    percentOff,
    ordersPlaced,
    couponsGenerated,
    nextMilestoneAt,
    eligible,
  } = milestone;
  const previous = nextMilestoneAt - n;
  const pct = Math.max(0, Math.min(100, ((ordersPlaced - previous) / n) * 100));
  // Milestones reached but not yet generated (they accumulate).
  const pending = Math.max(0, Math.floor(ordersPlaced / n) - couponsGenerated);

  const stat = (value, label) =>
    h(
      'div',
      { class: 'stat' },
      h('div', { class: 'stat__value' }, String(value)),
      h('div', { class: 'stat__label' }, label),
    );

  return h(
    'div',
    { class: ['card', 'milestone'] },
    h(
      'div',
      { class: 'card__body' },
      h(
        'div',
        { class: 'stats' },
        stat(ordersPlaced, 'orders placed'),
        stat(couponsGenerated, 'coupons generated'),
        stat(`#${nextMilestoneAt}`, 'next milestone'),
        stat(`${percentOff}%`, `off, every ${n} orders`),
      ),
      h(
        'div',
        {
          class: 'progress',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(Math.round(pct)),
          'aria-label': 'Progress to the next coupon',
        },
        h('div', { class: 'progress__bar', style: { width: `${pct}%` } }),
      ),
      h(
        'p',
        { class: 'hint' },
        eligible
          ? `Milestone ${nextMilestoneAt} reached — ${pluralize(pending, 'coupon')} ready to generate.`
          : `${pluralize(nextMilestoneAt - ordersPlaced, 'more order')} until milestone ${nextMilestoneAt}.`,
      ),
    ),
  );
}
