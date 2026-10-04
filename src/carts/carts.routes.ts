import { Router } from 'express';
import { z } from 'zod';
import { checkout } from '../checkout/checkout.service.js';
import { pool, withTransaction } from '../db/pool.js';
import * as carts from './carts.service.js';

const productId = z.string().min(1).max(64);
const quantity = z.number().int().min(1).max(100);

const cartParams = z.object({ cartId: z.uuid() });
const itemParams = z.object({ cartId: z.uuid(), productId });

const addItemBody = z.strictObject({ productId, quantity });
const setQuantityBody = z.strictObject({ quantity });
// Checkout takes no fields yet (coupons will add one). A missing body counts as {}.
const checkoutBody = z.object({}).strict();

export const cartsRouter = Router();

cartsRouter.post('/', async (_req, res) => {
  res.status(201).json(await carts.createCart(pool));
});

cartsRouter.get('/:cartId', async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  res.json(await carts.getCart(pool, cartId));
});

cartsRouter.post('/:cartId/items', async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  const body = addItemBody.parse(req.body);
  const cart = await withTransaction((client) =>
    carts.addItem(client, cartId, body.productId, body.quantity),
  );
  res.json(cart);
});

cartsRouter.put('/:cartId/items/:productId', async (req, res) => {
  const params = itemParams.parse(req.params);
  const body = setQuantityBody.parse(req.body);
  const cart = await withTransaction((client) =>
    carts.setItemQuantity(client, params.cartId, params.productId, body.quantity),
  );
  res.json(cart);
});

cartsRouter.delete('/:cartId/items/:productId', async (req, res) => {
  const params = itemParams.parse(req.params);
  const cart = await withTransaction((client) =>
    carts.removeItem(client, params.cartId, params.productId),
  );
  res.json(cart);
});

cartsRouter.post('/:cartId/checkout', async (req, res) => {
  const { cartId } = cartParams.parse(req.params);
  checkoutBody.parse(req.body ?? {});

  const { status, order } = await checkout(cartId);

  // 200 means this cart was already checked out and we are returning its existing order.
  if (status === 200) res.set('Idempotent-Replayed', 'true');
  res.status(status).json(order);
});
