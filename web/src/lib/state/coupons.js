/** Coupons (admin): the list, milestone progress, and generation. */
import { api } from '../api/endpoints.js';
import { patch, toErrorState } from './store.js';

export async function loadCoupons() {
  patch('coupons', { isLoading: true });
  try {
    const [list, milestone] = await Promise.all([
      api.admin.coupons.list(),
      api.admin.coupons.milestone(),
    ]);
    patch('coupons', {
      list: list.data,
      milestone: milestone.data,
      isLoading: false,
      error: null,
    });
  } catch (err) {
    patch('coupons', { isLoading: false, error: toErrorState(err, 'load coupons') });
  }
}

export async function generateCoupon() {
  patch('coupons', { isGenerating: true, notice: null });
  try {
    const { data } = await api.admin.coupons.generate();
    patch('coupons', { notice: { kind: 'created', coupon: data } });
  } catch (err) {
    patch('coupons', { notice: { kind: 'error', error: toErrorState(err, 'generate coupon') } });
  } finally {
    patch('coupons', { isGenerating: false });
    await loadCoupons();
  }
}

export function dismissCouponNotice() {
  patch('coupons', { notice: null });
}
