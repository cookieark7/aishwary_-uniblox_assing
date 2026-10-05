import { explainError } from '../../../lib/constants/error-codes.js';
import { h } from '../../../lib/utils/dom.js';
import { Badge } from './Badge.js';
import { Button } from './Button.js';
import { Callout } from './Callout.js';
import { JsonView } from './JsonView.js';

/**
 * Renders the API's { code, message, details } error in plain words, with the raw
 * details underneath so the reviewer sees exactly what the server sent.
 * @param {{ error: ReturnType<typeof import('../../../lib/state/store.js').toErrorState>,
 *   onDismiss?: () => void, tone?: 'error'|'warning' }} props
 */
export function ErrorCallout({ error, onDismiss, tone }) {
  const resolvedTone = tone ?? (error.status === 409 ? 'warning' : 'error');
  return Callout({
    tone: resolvedTone,
    icon: 'alert',
    role: 'alert',
    title: h(
      'span',
      null,
      Badge({
        text: `${error.status || 'ERR'} ${error.code}`,
        tone: resolvedTone === 'warning' ? 'warning' : 'error',
      }),
      ' ',
      error.message,
    ),
    text: explainError(error.code),
    children:
      error.details === undefined
        ? null
        : JsonView({ value: error.details, label: 'Error details' }),
    actions: onDismiss
      ? Button({
          label: 'Dismiss',
          icon: 'x',
          variant: 'ghost',
          size: 'sm',
          iconOnly: true,
          onClick: onDismiss,
        })
      : null,
  });
}
