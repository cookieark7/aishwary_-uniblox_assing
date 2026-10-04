import { Router } from 'express';
import { pool } from '../db/pool.js';

interface ProductRow {
  id: string;
  name: string;
  price_cents: number | string;
  stock: number | string;
}

export interface ProductView {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export const productsRouter = Router();

productsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(
    'SELECT id, name, price_cents, stock FROM products ORDER BY id',
  );
  const products: ProductView[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: Number(row.price_cents),
    stock: Number(row.stock),
  }));
  res.json(products);
});
