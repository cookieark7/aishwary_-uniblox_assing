import express, { type Express } from 'express';
import { pool } from './db/pool.js';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  });

  return app;
}
