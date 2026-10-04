import express, { type Express } from 'express';
import { pool } from './db/pool.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
