import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/**
 * Primary / Secondary / Ghost / Danger. A loading button shows a spinner and is disabled.
 * @param {{ label?: string, icon?: string, variant?: 'primary'|'secondary'|'ghost'|'danger',
 *   size?: 'sm', onClick?: (e: MouseEvent) => void, disabled?: boolean, loading?: boolean,
 *   title?: string, ariaLabel?: string, focusKey?: string, iconOnly?: boolean }} props
 */
export function Button({
  label,
  icon,
  variant = 'secondary',
  size,
  onClick,
  disabled = false,
  loading = false,
  title,
  ariaLabel,
  focusKey,
  iconOnly = false,
}) {
  return h(
    'button',
    {
      type: 'button',
      class: ['btn', `btn--${variant}`, { 'btn--sm': size === 'sm', 'btn--icon': iconOnly }],
      disabled: disabled || loading,
      'aria-busy': loading ? 'true' : null,
      'aria-label': ariaLabel ?? (iconOnly ? label : null),
      title: title ?? (iconOnly ? label : null),
      'data-focus-key': focusKey ?? null,
      onClick,
    },
    loading ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon ? Icon(icon) : null,
    iconOnly ? null : label,
  );
}
