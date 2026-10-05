/**
 * Layer 0 — localStorage for per-browser conveniences only (the current cart id, the
 * orders you placed). Never relied on: storage can be blocked or empty, so every access
 * is guarded and the app works without it.
 */
export function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode, blocked): the session simply isn't remembered
  }
}
