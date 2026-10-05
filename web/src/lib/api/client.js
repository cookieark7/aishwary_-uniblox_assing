/**
 * Layer 0 — the only place that calls fetch().
 *
 * - Same origin as the API (Express serves this UI), so no CORS and every response
 *   header — including Idempotent-Replayed — is readable.
 * - Non-2xx responses become an ApiError carrying the API's { error: { code, message,
 *   details } } shape, so callers branch on `code`, never on message text.
 * - Every call is reported to listeners (the network inspector) without this module
 *   knowing they exist.
 */

export class ApiError extends Error {
  /**
   * @param {number} status   HTTP status, or 0 when the request never got a response
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @typedef {Object} RequestEvent
 * @property {'start' | 'end'} phase
 * @property {import('../types.js').NetworkEntry} entry
 */

/** @type {Set<(event: RequestEvent) => void>} */
const listeners = new Set();
let nextId = 1;

/** Subscribe to every request's start and end. Returns an unsubscribe function. */
export function onRequest(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(phase, entry) {
  for (const listener of listeners) listener({ phase, entry });
}

/**
 * @template T
 * @param {'GET' | 'POST' | 'PUT' | 'DELETE'} method
 * @param {string} path
 * @param {{ body?: unknown, signal?: AbortSignal, group?: string | null }} [opts]
 * @returns {Promise<{ data: T, status: number, replayed: boolean }>}
 */
export async function request(method, path, { body, signal, group = null } = {}) {
  /** @type {import('../types.js').NetworkEntry} */
  const entry = {
    id: nextId++,
    method,
    path,
    requestBody: body,
    status: null,
    responseBody: undefined,
    replayed: false,
    ms: null,
    group,
    startedAt: Date.now(),
  };
  const t0 = performance.now();
  emit('start', entry);

  let res;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    emit('end', {
      ...entry,
      status: 0,
      ms: performance.now() - t0,
      responseBody: aborted ? 'aborted' : 'network error',
    });
    if (aborted) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const replayed = res.headers.get('Idempotent-Replayed') === 'true';
  emit('end', {
    ...entry,
    status: res.status,
    responseBody: data,
    replayed,
    ms: performance.now() - t0,
  });

  if (!res.ok) {
    const error = data && typeof data === 'object' ? data.error : null;
    throw new ApiError(
      res.status,
      error?.code ?? `HTTP_${res.status}`,
      error?.message ?? res.statusText,
      error?.details,
    );
  }
  return { data, status: res.status, replayed };
}

/**
 * Turns a request promise into a plain outcome that never throws — for firing many
 * requests in parallel and looking at every result.
 */
export function settle(promise) {
  return promise.then(
    (res) => ({ ok: true, status: res.status, replayed: res.replayed, data: res.data }),
    (err) => ({
      ok: false,
      status: err instanceof ApiError ? err.status : 0,
      code: err instanceof ApiError ? err.code : 'NETWORK_ERROR',
      message: err.message,
      details: err instanceof ApiError ? err.details : undefined,
      replayed: false,
      data: null,
    }),
  );
}
