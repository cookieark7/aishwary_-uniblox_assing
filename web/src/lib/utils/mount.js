/**
 * Layer 0 — binds a DOM region to a slice of the store.
 *
 * `select(state)` returns the slices the region depends on. The region re-renders only
 * when one of those references changes (state is updated immutably), which is the
 * vanilla equivalent of a component re-rendering when its props change.
 *
 * Re-rendering replaces the region's DOM, so keyboard focus is carried across by
 * `data-focus-key`: if the focused element had one, the element with the same key is
 * focused again afterwards (with its text selection), so keyboard users never lose
 * their place.
 */
export function mount(container, store, select, render) {
  let previous = null;

  const update = (state) => {
    const deps = select(state);
    if (previous && deps.length === previous.length && deps.every((d, i) => d === previous[i])) {
      return;
    }
    previous = deps;

    const active = document.activeElement;
    const focus =
      active && container.contains(active) && active instanceof HTMLElement
        ? {
            key: active.closest('[data-focus-key]')?.getAttribute('data-focus-key'),
            start: 'selectionStart' in active ? safeSelection(active, 'selectionStart') : null,
            end: 'selectionEnd' in active ? safeSelection(active, 'selectionEnd') : null,
          }
        : null;

    container.replaceChildren(render(state));

    if (focus?.key) {
      const next = container.querySelector(`[data-focus-key="${CSS.escape(focus.key)}"]`);
      if (next instanceof HTMLElement) {
        next.focus({ preventScroll: true });
        if (focus.start !== null && 'setSelectionRange' in next) {
          try {
            /** @type {HTMLInputElement} */ (next).setSelectionRange(focus.start, focus.end);
          } catch {
            // number inputs have no selection; focus alone is enough
          }
        }
      }
    }
  };

  const unsubscribe = store.subscribe(update);
  update(store.get());
  return unsubscribe;
}

function safeSelection(el, prop) {
  try {
    return el[prop];
  } catch {
    return null;
  }
}
