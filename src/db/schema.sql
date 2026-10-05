DROP TABLE IF EXISTS idempotency_keys, order_items, orders, coupons, cart_items, carts, products CASCADE;

CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE carts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'checked_out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  cart_id    UUID    NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT    NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  milestone   INTEGER NOT NULL UNIQUE CHECK (milestone > 0),
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMPTZ,
  CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL))
);

CREATE TABLE orders (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id        UUID    NOT NULL UNIQUE REFERENCES carts(id),
  coupon_id      UUID    UNIQUE REFERENCES coupons(id),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (discount_cents <= subtotal_cents),
  CHECK (total_cents = subtotal_cents - discount_cents)
);

CREATE TABLE order_items (
  order_id         UUID    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       TEXT    NOT NULL REFERENCES products(id),
  product_name     TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents = unit_price_cents * quantity),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  request_hash    TEXT NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
