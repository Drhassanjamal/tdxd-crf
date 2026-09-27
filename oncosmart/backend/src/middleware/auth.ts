import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool, q1 } from '../db/pool';
import { forbidden, unauthorized } from '../utils/errors';
import { can, Permission, Role } from '../utils/permissions';

export const SESSION_COOKIE = 'oncosmart_session';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any, issuer: 'oncosmart' });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

/** Verifies the httpOnly session cookie and re-loads the user (so deactivation takes effect immediately). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(unauthorized());
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'oncosmart' }) as jwt.JwtPayload;
  } catch {
    return next(unauthorized('Session expired — please sign in again'));
  }
  const user = await q1<{ id: string; email: string; full_name: string; role_code: Role; is_active: boolean }>(
    pool,
    'SELECT id, email, full_name, role_code, is_active FROM users WHERE id = $1',
    [payload.sub],
  );
  if (!user || !user.is_active) return next(unauthorized('Account is inactive'));
  req.user = { id: user.id, email: user.email, fullName: user.full_name, role: user.role_code };
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!permissions.some((p) => can(req.user!.role, p))) return next(forbidden());
    next();
  };
}
