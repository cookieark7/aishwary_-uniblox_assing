import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/**
 * Shows a short value and copies the full one. The ✓ feedback is local DOM state on
 * purpose: it is not app state and must not trigger a re-render.
 * @param {{ value: string, display?: string, label?: string }} props
 */
export function CopyButton({ value, display, label = 'Copy' }) {
  const button = h(
    'button',
    {
      type: 'button',
      class: ['btn', 'btn--ghost', 'btn--sm', 'id'],
      title: `${label}: ${value}`,
      'aria-label': `${label} ${value}`,
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(value);
          button.replaceChildren(Icon('check', { size: 12 }), display ?? value);
          setTimeout(
            () => button.replaceChildren(Icon('copy', { size: 12 }), display ?? value),
            1200,
          );
        } catch {
          // clipboard blocked: the full value is still in the title tooltip
        }
      },
    },
    Icon('copy', { size: 12 }),
    display ?? value,
  );
  return button;
}
