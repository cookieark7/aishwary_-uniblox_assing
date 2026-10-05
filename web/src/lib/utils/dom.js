/**
 * Layer 0 — DOM helpers. `h()` is the vanilla stand-in for JSX, `cn()` for clsx.
 * Text always goes in as text nodes, so server data can never inject markup.
 */

/** @typedef {string | number | null | undefined | false | Record<string, unknown> | ClassValue[]} ClassValue */

/** Joins class names: strings, arrays, and `{ name: condition }` objects. */
export function cn(...inputs) {
  const out = [];
  for (const input of inputs.flat(Infinity)) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') out.push(String(input));
    else if (typeof input === 'object') {
      for (const [name, on] of Object.entries(input)) if (on) out.push(name);
    }
  }
  return out.join(' ');
}

/**
 * Creates an element.
 * - `class` takes anything `cn()` takes; `style` takes an object (CSS vars allowed).
 * - `onClick`, `onInput`, … add listeners; `dataset` sets data-* attributes.
 * - Attributes with a dash (aria-*, data-*) and unknown keys become attributes;
 *   known DOM properties (value, disabled, type, …) are set as properties.
 * - `null`, `undefined` and `false` props/children are skipped.
 *
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = cn(value);
      else if (key === 'style') {
        for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, String(v));
      } else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (!key.includes('-') && key in el) /** @type {any} */ (el)[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

/** Appends children, flattening arrays and skipping empty values. */
export function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** A fragment, for components that return several siblings. */
export function fragment(...children) {
  return append(document.createDocumentFragment(), children);
}

/** True when the user is typing, so global shortcuts must stay quiet. */
export function isTypingTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
