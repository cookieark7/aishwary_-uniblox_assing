# Uniblox backend

Node 20+ / TypeScript (strict) / Express 5 / PostgreSQL (`pg`) / zod.

Runs directly from TypeScript with `tsx`. There is no build step; `tsc --noEmit` is used only for type checking.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your Neon connection string. Use the **direct (non-pooled)** host,
   the one without `-pooler`, and keep `sslmode=require`. `.env` is git-ignored and must never be committed.

   | Variable       | Required | Default | Notes                                |
   | -------------- | -------- | ------- | ------------------------------------ |
   | `DATABASE_URL` | yes      | none    | `postgres://` or `postgresql://` URL |
   | `PORT`         | no       | `3000`  | Integer between 1 and 65535          |

   The process refuses to start if either value is invalid.

   > `pg` currently treats `sslmode=require` as `verify-full`, so it fully verifies the server certificate. That works with Neon.
   > At startup it prints a one-time `SECURITY WARNING` about this; the warning is informational.

## Scripts

| Command             | What it does                           |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Start with file watching (`tsx watch`) |
| `npm start`         | Start the server (`tsx src/server.ts`) |
| `npm run typecheck` | `tsc --noEmit`                         |
| `npm test`          | Run the vitest suite once              |
| `npm run format`    | Format everything with prettier        |

Check it works:

```bash
curl localhost:3000/health
# {"status":"ok","db":"ok"}
```

Tests use supertest against `createApp()` and talk to the real database in `DATABASE_URL`, so `.env` must be set up first.

## Layout

```
src/
  config.ts      env loading + zod validation (crashes on invalid config)
  db/pool.ts     single pg Pool + withTransaction(fn)
  errors.ts      AppError + 404 and central error middleware
  app.ts         createApp(): builds the Express app (imported by tests)
  server.ts      listen() + graceful shutdown
tests/
  health.test.ts
```

## Error responses

Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [] } }
```

| Case                        | Status | `code`             |
| --------------------------- | ------ | ------------------ |
| `throw new AppError(...)`   | custom | custom             |
| `ZodError`                  | 400    | `VALIDATION_ERROR` |
| Malformed JSON body         | 400    | `INVALID_JSON`     |
| Unknown route               | 404    | `NOT_FOUND`        |
| DB unreachable on `/health` | 503    | `DB_UNAVAILABLE`   |
| Anything else               | 500    | `INTERNAL_ERROR`   |

For a 500 the full error is logged on the server, and the client only gets the generic message.
