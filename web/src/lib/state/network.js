/** Network inspector state: every request the UI makes, newest first. */
import { onRequest } from '../api/client.js';
import { patch, store } from './store.js';

const MAX_ENTRIES = 300;

/** Starts recording. Called once at boot. */
export function startRecording() {
  return onRequest(({ phase, entry }) => {
    patch('network', (slice) => {
      if (phase === 'start') {
        return { entries: [entry, ...slice.entries].slice(0, MAX_ENTRIES) };
      }
      return { entries: slice.entries.map((e) => (e.id === entry.id ? entry : e)) };
    });
  });
}

export function toggleEntry(id) {
  patch('network', (slice) => ({ expandedId: slice.expandedId === id ? null : id }));
}

export function collapseEntry() {
  if (store.get().network.expandedId !== null) patch('network', { expandedId: null });
}

export function clearLog() {
  patch('network', { entries: [], expandedId: null });
}
