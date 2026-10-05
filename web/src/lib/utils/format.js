/** Layer 0 — formatting. Money arrives as integer paise; we only divide for display. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 59999 → "₹599.99" */
export function formatPaise(paise) {
  return inr.format(paise / 100);
}

/** First block of a UUID — enough to tell ids apart on screen. */
export function shortId(id) {
  return id ? String(id).slice(0, 8) : '';
}

export function formatMs(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(date));
}

export function pluralize(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
