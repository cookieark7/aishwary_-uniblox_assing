import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '../errors.js';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const MAX_KEY_LENGTH = 255;

/** Validates the raw Idempotency-Key header value: required, 1–255 characters. */
export function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      `The ${IDEMPOTENCY_HEADER} header is required`,
    );
  }
  if (value.length > MAX_KEY_LENGTH) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      {
        path: IDEMPOTENCY_HEADER,
        message: `Must be at most ${MAX_KEY_LENGTH} characters`,
        code: 'too_big',
      },
    ]);
  }
  return value;
}

/**
 * Fingerprint of a request, so a key reused for a different request can be detected.
 * `body` must be the zod-parsed body: its key order follows the schema, which makes
 * the JSON deterministic.
 */
export function hashRequest(methodAndPath: string, body: unknown): string {
  return createHash('sha256')
    .update(methodAndPath + JSON.stringify(body))
    .digest('hex');
}

export type ClaimResult =
  { claimed: true } | { claimed: false; responseStatus: number; responseBody: unknown };

/**
 * Claims `key` for this transaction, or returns the response stored by an earlier request.
 *
 * Concurrent duplicates: if another transaction has inserted the same key but not yet
 * committed, our INSERT blocks on the primary-key index until that transaction ends.
 * - If it committed, our INSERT does nothing, and the SELECT below (a new statement, so a
 *   fresh READ COMMITTED snapshot) sees its stored response, which we replay.
 * - If it rolled back, the key no longer exists, so our INSERT succeeds and we claim it.
 * Either way only one request ever does the work for a given key.
 */
export async function claimKey(
  client: PoolClient,
  key: string,
  requestHash: string,
): Promise<ClaimResult> {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, requestHash],
  );
  if (inserted.rowCount === 1) return { claimed: true };

  const { rows } = await client.query<{
    request_hash: string;
    response_status: number | null;
    response_body: unknown;
  }>('SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1', [
    key,
  ]);
  const existing = rows[0];
  if (!existing || existing.response_status === null) {
    // Unreachable: a key row only becomes visible once its transaction commits,
    // and that same transaction always stores the response.
    throw new Error(`Idempotency key ${key} exists without a stored response`);
  }
  if (existing.request_hash !== requestHash) {
    throw new AppError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      `${IDEMPOTENCY_HEADER} was already used for a different request`,
    );
  }
  return {
    claimed: false,
    responseStatus: Number(existing.response_status),
    responseBody: existing.response_body,
  };
}

/** Stores the response for a claimed key. Commits (or rolls back) with the caller's transaction. */
export async function saveResponse(
  client: PoolClient,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await client.query(
    'UPDATE idempotency_keys SET response_status = $2, response_body = $3 WHERE key = $1',
    [key, status, JSON.stringify(body)],
  );
}
