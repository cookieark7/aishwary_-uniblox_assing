import { h } from '../../../lib/utils/dom.js';

export function Kbd(text) {
  return h('kbd', { class: 'kbd' }, text);
}
