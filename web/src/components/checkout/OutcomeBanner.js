import { Badge } from '../common/ui/Badge.js';
import { Callout } from '../common/ui/Callout.js';
import { ErrorCallout } from '../common/ui/ErrorCallout.js';
import { h } from '../../lib/utils/dom.js';
import { formatTime, shortId } from '../../lib/utils/format.js';

/**
 * What the server answered, in one line, with the headers that matter.
 * @param {{ outcome: import('../../lib/state/checkout.js').CheckoutOutcome,
 *   rejectedBeforeTransaction: boolean }} props
 */
export function OutcomeBanner({ outcome, rejectedBeforeTransaction }) {
  const sent = h(
    'span',
    { class: 'hint' },
    ` · sent ${outcome.couponSent === undefined ? 'no body' : JSON.stringify({ couponCode: outcome.couponSent })} at ${formatTime(outcome.at)}`,
  );

  if (outcome.kind === 'created') {
    return Callout({
      tone: 'success',
      icon: 'check',
      title: h(
        'span',
        null,
        Badge({ text: '201 Created', tone: 'success' }),
        ` Order ${shortId(outcome.order?.id)} placed`,
        sent,
      ),
      text: 'The cart is now closed. Checking it out again is a safe retry.',
    });
  }
  if (outcome.kind === 'replayed') {
    return Callout({
      tone: 'neutral',
      icon: 'refresh',
      title: h(
        'span',
        null,
        Badge({ text: '200 OK', tone: 'accent' }),
        ' ',
        Badge({ text: 'Idempotent-Replayed: true', tone: 'accent' }),
        ` Same order ${shortId(outcome.order?.id)} returned`,
        sent,
      ),
      text: 'The cart is the idempotency key: a repeat with the same options writes nothing and replays the original order.',
    });
  }
  return h(
    'div',
    { class: 'stack-sm' },
    outcome.error ? ErrorCallout({ error: outcome.error }) : null,
    h(
      'p',
      { class: 'hint' },
      rejectedBeforeTransaction
        ? 'Rejected before any transaction started — nothing was touched.'
        : 'The transaction rolled back: the cart is still open, any coupon is still available, and stock is unchanged.',
      sent,
    ),
  );
}
