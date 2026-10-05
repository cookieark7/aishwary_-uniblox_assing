import { h } from '../../lib/utils/dom.js';
import { icon as Icon } from '../../lib/utils/icons.js';

/** What the reviewer typed. Local UI state that survives re-renders (see ProductTable). */
let draft = '';

export function getCouponDraft() {
  return draft;
}

export function setCouponDraft(value) {
  draft = value;
}

/**
 * Coupon input. Sent exactly as typed — the server trims, upper-cases and validates it —
 * so `"  save-abcd2345 "` works and `"   "` shows the 400.
 * @param {{ available: import('../../lib/types.js').Coupon[], disabled: boolean,
 *   onSubmit: () => void }} props
 */
export function CouponField({ available, disabled, onSubmit }) {
  const input = h('input', {
    id: 'coupon',
    class: ['input', 'input--mono', 'coupon__input'],
    value: draft,
    placeholder: 'SAVE-XXXXXXXX (optional)',
    autocomplete: 'off',
    disabled,
    'data-focus-key': 'coupon-input',
    onInput: (e) => (draft = e.target.value),
    onKeyDown: (e) => {
      if (e.key === 'Enter') onSubmit();
    },
  });

  return h(
    'div',
    { class: 'coupon' },
    h('label', { for: 'coupon', class: 'coupon__label' }, Icon('ticket'), 'Coupon code'),
    input,
    h(
      'p',
      { class: 'hint' },
      'Empty sends no body. Anything else is sent as typed; the server trims and upper-cases it.',
    ),
    available.length > 0
      ? h(
          'div',
          { class: 'coupon__chips' },
          h('span', { class: 'hint' }, 'Available (from admin):'),
          available.map((c) =>
            h(
              'button',
              {
                type: 'button',
                class: ['chip', 'mono'],
                disabled,
                title: `${c.percentOff}% off · milestone ${c.milestone}`,
                onClick: () => {
                  draft = c.code;
                  input.value = c.code;
                  input.focus();
                },
              },
              `${c.code} · ${c.percentOff}%`,
            ),
          ),
        )
      : null,
  );
}
