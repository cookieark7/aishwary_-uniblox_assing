import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/**
 * @param {{ text: string, tone?: 'neutral'|'success'|'error'|'warning'|'accent', pill?: boolean,
 *   icon?: string, title?: string, style?: Record<string, string> }} props
 */
export function Badge({ text, tone = 'neutral', pill = false, icon, title, style }) {
  return h(
    'span',
    {
      class: ['badge', tone !== 'neutral' && `badge--${tone}`, { 'badge--pill': pill }],
      title,
      style,
    },
    icon ? Icon(icon, { size: 12 }) : null,
    text,
  );
}
