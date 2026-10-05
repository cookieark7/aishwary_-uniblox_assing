import express, { type Express } from 'express';
import { fileURLToPath } from 'node:url';
import { cartsRouter } from './carts/carts.routes.js';
import { adminRouter } from './coupons/coupons.routes.js';
import { pool } from './db/pool.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';
import { ordersRouter } from './orders/orders.routes.js';
import { productsRouter } from './products/products.routes.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.error('health check: database unreachable', err);
      throw new AppError(503, 'DB_UNAVAILABLE', 'Database is unavailable');
    }
    res.json({ status: 'ok', db: 'ok' });
  });

  app.use('/products', productsRouter);
  app.use('/carts', cartsRouter);
  app.use('/orders', ordersRouter);
  app.use('/admin', adminRouter);

  // Reviewer UI (web/): plain static files on the same origin, so no CORS and no build step.
  app.use(express.static(fileURLToPath(new URL('../web', import.meta.url))));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
