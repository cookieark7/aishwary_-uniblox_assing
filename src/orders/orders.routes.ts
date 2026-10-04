import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getOrderView } from './orders.service.js';

const orderParams = z.object({ orderId: z.uuid() });

export const ordersRouter = Router();

ordersRouter.get('/:orderId', async (req, res) => {
  const { orderId } = orderParams.parse(req.params);
  res.json(await getOrderView(pool, orderId));
});
