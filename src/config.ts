import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // A coupon becomes available every N orders, for COUPON_PERCENT_OFF percent off.
  COUPON_EVERY_N_ORDERS: z.coerce.number().int().min(1).default(5),
  COUPON_PERCENT_OFF: z.coerce.number().int().min(1).max(100).default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: the process must not start with a broken configuration.
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const config = parsed.data;
export type Config = typeof config;
