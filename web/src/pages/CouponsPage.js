import { setCouponDraft } from '../components/checkout/CouponField.js';
import { TopBar } from '../components/common/layout/TopBar.js';
import { Badge } from '../components/common/ui/Badge.js';
import { Button } from '../components/common/ui/Button.js';
import { Callout } from '../components/common/ui/Callout.js';
import { ErrorCallout } from '../components/common/ui/ErrorCallout.js';
import { Spinner } from '../components/common/ui/Spinner.js';
import { CouponTable } from '../components/coupons/CouponTable.js';
import { MilestoneProgress } from '../components/coupons/MilestoneProgress.js';
import { SECTIONS } from '../lib/constants/sections.js';
import { dismissCouponNotice, generateCoupon } from '../lib/state/coupons.js';
import { selectOrder } from '../lib/state/orders.js';
import { h } from '../lib/utils/dom.js';

function useAtCheckout(code) {
  setCouponDraft(code);
  location.hash = SECTIONS.checkout.route;
}

function openOrder(orderId) {
  location.hash = SECTIONS.orders.route;
  selectOrder(orderId);
}

export function CouponsPage(state) {
  const { list, milestone, isLoading, isGenerating, notice, error } = state.coupons;

  return [
    TopBar({
      section: SECTIONS.coupons,
      actions: Button({
        label: 'Generate coupon',
        icon: 'ticket',
        variant: 'primary',
        loading: isGenerating,
        focusKey: 'generate-coupon',
        onClick: generateCoupon,
      }),
    }),
    Callout({
      tone: 'warning',
      icon: 'shield',
      title: h('span', null, 'Admin only ', Badge({ text: 'no auth', tone: 'warning' })),
      text: 'These /admin routes are for store staff. Per the brief there is no authentication yet, so anyone who can reach the server can call them.',
    }),
    notice?.kind === 'created'
      ? Callout({
          tone: 'success',
          icon: 'check',
          title: h(
            'span',
            null,
            Badge({ text: '201 Created', tone: 'success' }),
            ` ${notice.coupon.code} for milestone #${notice.coupon.milestone}`,
          ),
          text: `${notice.coupon.percentOff}% off one order. Single use.`,
          actions: Button({
            label: 'Dismiss',
            icon: 'x',
            variant: 'ghost',
            size: 'sm',
            iconOnly: true,
            onClick: dismissCouponNotice,
          }),
        })
      : null,
    notice?.kind === 'error'
      ? ErrorCallout({ error: notice.error, onDismiss: dismissCouponNotice })
      : null,
    error ? ErrorCallout({ error }) : null,
    milestone
      ? MilestoneProgress({ milestone })
      : isLoading
        ? h('div', { class: 'empty' }, Spinner({ label: 'Loading milestone' }))
        : null,
    h(
      'div',
      { class: ['card', 'table-scroll'] },
      h(
        'div',
        { class: 'card__header' },
        h('div', { class: 'card__title' }, 'All coupons'),
        h('span', { class: 'hint' }, 'newest first'),
      ),
      CouponTable({ list, onUse: useAtCheckout, onOpenOrder: openOrder }),
    ),
    h(
      'p',
      { class: 'hint' },
      'Milestones accumulate: the next one is (coupons generated + 1) × N, so a milestone nobody generated is still claimable later. Discount = floor(subtotal × percent / 100), in paise.',
    ),
  ];
}
