/** API + database health, shown in the sidebar. */
import { api } from '../api/endpoints.js';
import { patch } from './store.js';

export async function checkHealth() {
  try {
    await api.health();
    patch('health', { status: 'ok' });
  } catch {
    patch('health', { status: 'down' });
  }
}
