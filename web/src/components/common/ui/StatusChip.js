import { h } from '../../../lib/utils/dom.js';

/** HTTP status → colour bucket. 409s get their own (amber): in races they are the expected losers. */
export function statusTone(status) {
  if (status === null || status === undefined) return 'pending';
  if (status === 0) return '0';
  if (status < 300) return '2xx';
  if (status === 409) return '409';
  if (status < 500) return '4xx';
  return '5xx';
}

/** @param {{ status: number | null, text?: string }} props */
export function StatusChip({ status, text }) {
  const tone = statusTone(status);
  return h(
    'span',
    { class: ['status', `status--${tone}`] },
    tone === 'pending' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
    text ?? (tone === 'pending' ? '…' : status === 0 ? 'ERR' : String(status)),
  );
}
