import { h } from '../../../lib/utils/dom.js';

/** @param {{ label?: string }} [props] */
export function Spinner({ label = 'Loading' } = {}) {
  return h('span', { class: 'spinner', role: 'status', 'aria-label': label });
}
