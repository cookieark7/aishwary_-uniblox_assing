import type { PoolClient } from 'pg';
import type { Queryable } from '../db/pool.js';
import { AppError } from '../errors.js';

export type CartStatus = 'open' | 'checked_out';

export interface CartItemView {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  availableStock: number;
  inStock: boolean;
}

export interface CartView {
  id: string;
  status: CartStatus;
  /** Set once the cart has been checked out. */
  orderId: string | null;
  items: CartItemView[];
  itemCount: number;
  subtotalCents: number;
  currency: 'INR';
}

/** One row per cart item; item columns are null for an empty cart (LEFT JOIN). */
interface CartRow {
  cart_id: string;
  status: CartStatus;
  order_id: string | null;
  product_id: string | null;
  name: string | null;
  price_cents: number | string | null;
  stock: number | string | null;
  quantity: number | string | null;
}

const cartNotFound = (cartId: string) =>
  new AppError(404, 'CART_NOT_FOUND', `Cart ${cartId} not found`);

const cartItemNotFound = (cartId: string, productId: string) =>
  new AppError(404, 'CART_ITEM_NOT_FOUND', `Product ${productId} is not in cart ${cartId}`);

function toCartView(rows: CartRow[]): CartView {
  const first = rows[0]!;
  const items: CartItemView[] = rows
    .filter((row) => row.product_id !== null)
    .map((row) => {
      const unitPriceCents = Number(row.price_cents);
      const quantity = Number(row.quantity);
      const availableStock = Number(row.stock);
      return {
        productId: row.product_id!,
        name: row.name!,
        unitPriceCents,
        quantity,
        lineTotalCents: unitPriceCents * quantity,
        availableStock,
        inStock: availableStock >= quantity,
      };
    });

  return {
    id: first.cart_id,
    status: first.status,
    orderId: first.order_id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    currency: 'INR',
  };
}

/** Reads the cart and prices every line at the product's CURRENT price, in a single query. */
export async function getCart(db: Queryable, cartId: string): Promise<CartView> {
  const { rows } = await db.query<CartRow>(
    `SELECT c.id AS cart_id, c.status, o.id AS order_id,
            ci.product_id, p.name, p.price_cents, p.stock, ci.quantity
       FROM carts c
       LEFT JOIN orders o ON o.cart_id = c.id
       LEFT JOIN cart_items ci ON ci.cart_id = c.id
       LEFT JOIN products p ON p.id = ci.product_id
      WHERE c.id = $1
      ORDER BY ci.product_id`,
    [cartId],
  );
  if (rows.length === 0) throw cartNotFound(cartId);
  return toCartView(rows);
}

export async function createCart(db: Queryable): Promise<CartView> {
  const { rows } = await db.query<{ id: string }>('INSERT INTO carts DEFAULT VALUES RETURNING id');
  return getCart(db, rows[0]!.id);
}

/**
 * Locks the cart row until the surrounding transaction ends, so concurrent edits
 * (and checkout) on the same cart are serialised. Must run inside a transaction.
 */
export async function lockOpenCart(client: PoolClient, cartId: string): Promise<void> {
  const { rows } = await client.query<{ status: CartStatus }>(
    'SELECT status FROM carts WHERE id = $1 FOR UPDATE',
    [cartId],
  );
  const cart = rows[0];
  if (!cart) throw cartNotFound(cartId);
  if (cart.status !== 'open') {
    throw new AppError(409, 'CART_NOT_OPEN', `Cart ${cartId} is ${cart.status}`);
  }
}

/** Current stock of a product, or null if the product does not exist. */
async function getProductStock(client: PoolClient, productId: string): Promise<number | null> {
  const { rows } = await client.query<{ stock: number | string }>(
    'SELECT stock FROM products WHERE id = $1',
    [productId],
  );
  return rows[0] ? Number(rows[0].stock) : null;
}

/**
 * Soft availability check: nothing is reserved, checkout re-checks for real.
 * Throwing here rolls back the write that produced `requested`.
 */
function assertStock(productId: string, requested: number, available: number): void {
  if (requested > available) {
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      `Only ${available} of ${productId} available, ${requested} requested`,
      { productId, requested, available },
    );
  }
}

/** Adds `quantity` to the line (creating it if needed). Must run inside a transaction. */
export async function addItem(
  client: PoolClient,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<CartView> {
  await lockOpenCart(client, cartId);

  const stock = await getProductStock(client, productId);
  if (stock === null) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} not found`);
  }

  const { rows } = await client.query<{ quantity: number | string }>(
    `INSERT INTO cart_items (cart_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, product_id)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
     RETURNING quantity`,
    [cartId, productId, quantity],
  );
  assertStock(productId, Number(rows[0]!.quantity), stock);

  return getCart(client, cartId);
}

/** Replaces the line's quantity. Must run inside a transaction. */
export async function setItemQuantity(
  client: PoolClient,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<CartView> {
  await lockOpenCart(client, cartId);

  const { rowCount } = await client.query(
    'UPDATE cart_items SET quantity = $3 WHERE cart_id = $1 AND product_id = $2',
    [cartId, productId, quantity],
  );
  if (rowCount === 0) throw cartItemNotFound(cartId, productId);

  // The FK on cart_items guarantees the product exists.
  const stock = (await getProductStock(client, productId))!;
  assertStock(productId, quantity, stock);

  return getCart(client, cartId);
}

/** Removes the line. Must run inside a transaction. */
export async function removeItem(
  client: PoolClient,
  cartId: string,
  productId: string,
): Promise<CartView> {
  await lockOpenCart(client, cartId);

  const { rowCount } = await client.query(
    'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2',
    [cartId, productId],
  );
  if (rowCount === 0) throw cartItemNotFound(cartId, productId);

  return getCart(client, cartId);
}
