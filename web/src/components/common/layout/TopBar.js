import { h } from '../../../lib/utils/dom.js';
import { icon as Icon } from '../../../lib/utils/icons.js';

/**
 * Page header. The section's identity colour tints only the icon tile.
 * @param {{ section: typeof import('../../../lib/constants/sections.js').SECTIONS.shop,
 *   actions?: any }} props
 */
export function TopBar({ section, actions }) {
  return h(
    'header',
    {
      class: 'topbar',
      style: { '--section-color': section.color, '--section-muted': section.muted },
    },
    h('div', { class: 'topbar__icon' }, Icon(section.icon, { size: 18 })),
    h(
      'div',
      { class: 'topbar__text' },
      h('div', { class: 'topbar__eyebrow' }, `${section.group} · step ${section.step}`),
      h('h1', null, section.title),
      h('p', { class: 'topbar__desc' }, section.description),
    ),
    actions ? h('div', { class: 'topbar__actions' }, actions) : null,
  );
}
