import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { pool, q1, tx } from '../db/pool';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '../middleware/auth';
import { actorFrom, audit } from '../services/audit.service';
import { getSettings } from '../services/settings.service';
import { changeOwnPassword } from '../services/users.service';
import { unauthorized } from '../utils/errors';
import { permissionsFor } from '../utils/permissions';
import { changePasswordSchema, loginSchema } from './schemas';

// Constant-time-ish comparison target so unknown e-mails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 11);

export async function login(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const user = await q1(pool, 'SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.is_active) {
    await audit(pool, { id: user?.id ?? null, email, role: user?.role_code ?? null, ip: req.ip, userAgent: req.headers['user-agent'] ?? null }, {
      action: 'USER_LOGIN_FAILED',
      entityType: 'user',
      entityId: user?.id ?? null,
      description: !user ? 'Unknown account' : !user.is_active ? 'Inactive account' : 'Wrong password',
    });
    throw unauthorized('Invalid e-mail or password');
  }
  await tx(async (db) => {
    await db.query('UPDATE users SET last_login_at = now() WHERE id=$1', [user.id]);
    await audit(db, { id: user.id, email: user.email, role: user.role_code, ip: req.ip, userAgent: req.headers['user-agent'] ?? null }, {
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
    });
  });
  res.cookie(SESSION_COOKIE, signSession(user.id), sessionCookieOptions());
  res.json({ user: publicUser(user) });
}

export async function logout(req: Request, res: Response) {
  if (req.user) await audit(pool, actorFrom(req), { action: 'USER_LOGOUT', entityType: 'user', entityId: req.user.id });
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}

/** Public: returns the current user if the session cookie is valid, else { user: null } (no 401). */
export async function session(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.json({ user: null });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'oncosmart' }) as jwt.JwtPayload;
    const user = await q1(pool, 'SELECT * FROM users WHERE id=$1 AND is_active', [payload.sub]);
    return res.json({ user: user ? publicUser(user) : null });
  } catch {
    return res.json({ user: null });
  }
}

export async function me(req: Request, res: Response) {
  const user = await q1(pool, 'SELECT * FROM users WHERE id=$1', [req.user!.id]);
  res.json({ user: publicUser(user) });
}

export async function changePassword(req: Request, res: Response) {
  const body = changePasswordSchema.parse(req.body);
  await tx((db) => changeOwnPassword(db, req.user!.id, body.currentPassword, body.newPassword, actorFrom(req)));
  res.json({ ok: true });
}

/** Unauthenticated configuration for the login screen. */
export async function publicConfig(_req: Request, res: Response) {
  const s = await getSettings();
  res.json({
    hospitalName: s.hospital_name,
    unitName: s.unit_name,
    demoMode: env.DEMO_MODE,
    defaultLanguage: s.default_language,
    demoAccounts: env.DEMO_MODE
      ? [
          { role: 'ADMIN', email: 'admin@demo.local' },
          { role: 'PHYSICIAN', email: 'doctor@demo.local' },
          { role: 'NURSE', email: 'nurse@demo.local' },
          { role: 'RECEPTION', email: 'reception@demo.local' },
        ]
      : [],
    demoPassword: env.DEMO_MODE ? env.SEED_DEMO_PASSWORD : undefined,
  });
}

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    fullNameAr: u.full_name_ar,
    role: u.role_code,
    title: u.title,
    permissions: permissionsFor(u.role_code),
  };
}
