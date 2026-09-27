import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

/** Maps domain, validation and PostgreSQL errors to clear, user-friendly responses. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = fields[0];
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: first ? `Invalid input${first.path ? ` — ${first.path}` : ''}: ${first.message}` : 'Invalid input',
        details: fields,
      },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  // PostgreSQL error codes
  switch (err?.code) {
    case '23505':
      return res.status(409).json({
        error: { code: 'DUPLICATE', message: duplicateMessage(err.constraint) },
      });
    case '23P01':
      return res.status(409).json({
        error: {
          code: 'CHAIR_CONFLICT',
          message: 'Chair already assigned to another patient for an overlapping time.',
        },
      });
    case '23503':
      return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'A referenced record does not exist.' } });
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'One or more values are out of the allowed range.' } });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred. Please try again.' } });
}

function duplicateMessage(constraint?: string): string {
  if (!constraint) return 'A record with the same unique value already exists.';
  if (constraint.includes('mrn')) return 'A patient with this MRN already exists.';
  if (constraint.includes('users_email')) return 'A user with this e-mail already exists.';
  if (constraint.includes('plan_cycle_day')) return 'An active treatment order already exists for this cycle and day.';
  if (constraint.includes('code')) return 'This code is already in use.';
  return 'A record with the same unique value already exists.';
}
