import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Errors raised by express.json() / body-parser carry `type`, `status` and `expose`. */
function isBodyParserError(
  err: unknown,
): err is Error & { type: string; status: number; expose: boolean } {
  return (
    err instanceof Error &&
    typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { status?: unknown }).status === 'number' &&
    (err as { expose?: unknown }).expose === true
  );
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));
    res.status(400).json(body('VALIDATION_ERROR', 'Request validation failed', details));
    return;
  }

  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json(body('INVALID_JSON', 'Request body is not valid JSON'));
    } else {
      res.status(err.status).json(body('BAD_REQUEST', err.message));
    }
    return;
  }

  // Unknown error: log everything server-side, leak nothing to the client.
  console.error(err);
  res.status(500).json(body('INTERNAL_ERROR', 'Internal server error'));
};
