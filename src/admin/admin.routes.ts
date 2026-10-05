import { Router } from 'express';
import { z } from 'zod';
import { generateCoupon, getMilestoneStatus, listCoupons } from '../coupons/coupons.service.js';
import { pool, withTransaction } from '../db/pool.js';
import { getReport } from '../reports/report.service.js';

// Admin-only. There is no auth per the brief; see the README.
export const adminRouter = Router();

const emptyBody = z.object({}).strict();

adminRouter.post('/coupons', async (req, res) => {
  emptyBody.parse(req.body ?? {});
  const coupon = await withTransaction((client) => generateCoupon(client));
  res.status(201).json(coupon);
});

adminRouter.get('/coupons', async (_req, res) => {
  res.json(await listCoupons(pool));
});

// Read-only progress towards the next coupon, so a UI can show it without trying POST.
adminRouter.get('/coupons/milestone', async (_req, res) => {
  res.json(await getMilestoneStatus(pool));
});

// Read-only sales summary. One snapshot, so its numbers always agree with each other.
adminRouter.get('/report', async (_req, res) => {
  res.json(await withTransaction((client) => getReport(client), { readOnlySnapshot: true }));
});
