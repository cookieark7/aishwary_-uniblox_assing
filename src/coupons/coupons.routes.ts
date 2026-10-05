import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { generateCoupon, getMilestoneStatus, listCoupons } from './coupons.service.js';

// Admin-only. There is no auth per the brief; see the README.
export const adminRouter = Router();

const generateBody = z.object({}).strict();

adminRouter.post('/coupons', async (req, res) => {
  generateBody.parse(req.body ?? {});
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
