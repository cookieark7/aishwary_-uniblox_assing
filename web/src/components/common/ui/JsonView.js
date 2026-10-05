import { h } from '../../../lib/utils/dom.js';

// Matches, in order: "key":  |  "string"  |  number  |  true/false/null
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/**
 * Pretty-printed, lightly highlighted JSON. Built from text nodes, never innerHTML,
 * so response bodies can't inject markup.
 * @param {{ value: unknown, label?: string }} props
 */
export function JsonView({ value, label }) {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'undefined');
  const pre = h('pre', { class: 'json', 'aria-label': label ?? null, tabIndex: 0 });
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) pre.append(text.slice(last, m.index));
    if (m[1] && m[2]) pre.append(h('span', { class: 'j-key' }, m[1]), m[2]);
    else if (m[1]) pre.append(h('span', { class: 'j-str' }, m[1]));
    else if (m[3]) pre.append(h('span', { class: 'j-num' }, m[3]));
    else pre.append(h('span', { class: 'j-lit' }, m[4]));
    last = m.index + m[0].length;
  }
  if (last < text.length) pre.append(text.slice(last));
  return pre;
}
