import bcrypt from 'bcryptjs';
import { Db, pool, q, q1 } from '../db/pool';
import { conflict, notFound, validationError } from '../utils/errors';
import { Actor, audit } from './audit.service';

const PUBLIC_COLUMNS = 'id, email, full_name, full_name_ar, role_code, title, phone, is_active, last_login_at, created_at';

export function validatePassword(pw: string) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw validationError('Password must be at least 8 characters and contain letters and numbers.');
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);

export async function listUsers() {
  return q(pool, `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY role_code, full_name`);
}

export async function listPhysicians() {
  return q(pool, `SELECT id, full_name, full_name_ar, title FROM users WHERE role_code='PHYSICIAN' AND is_active ORDER BY full_name`);
}

export async function createUser(
  db: Db,
  u: { email: string; password: string; fullName: string; fullNameAr?: string | null; role: string; title?: string | null; phone?: string | null },
  actor: Actor,
) {
  validatePassword(u.password);
  const row = await q1(
    db,
    `INSERT INTO users (email, password_hash, full_name, full_name_ar, role_code, title, phone, password_changed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING ${PUBLIC_COLUMNS}`,
    [u.email.trim().toLowerCase(), await hashPassword(u.password), u.fullName, u.fullNameAr ?? null, u.role, u.title ?? null, u.phone ?? null],
  );
  await audit(db, actor, { action: 'USER_CREATED', entityType: 'user', entityId: row.id, next: { email: row.email, role: row.role_code } });
  return row;
}

export async function updateUser(
  db: Db,
  id: string,
  u: { fullName?: string; fullNameAr?: string | null; role?: string; title?: string | null; phone?: string | null; isActive?: boolean },
  actor: Actor,
) {
  const before = await q1(db, `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id=$1`, [id]);
  if (!before) throw notFound('User');
  if (id === actor.id && (u.isActive === false || (u.role && u.role !== before.role_code))) {
    throw conflict('You cannot deactivate your own account or change your own role.');
  }
  const row = await q1(
    db,
    `UPDATE users SET full_name=COALESCE($2, full_name), full_name_ar=COALESCE($3, full_name_ar), role_code=COALESCE($4, role_code),
            title=COALESCE($5, title), phone=COALESCE($6, phone), is_active=COALESCE($7, is_active)
      WHERE id=$1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, u.fullName ?? null, u.fullNameAr ?? null, u.role ?? null, u.title ?? null, u.phone ?? null, u.isActive ?? null],
  );
  await audit(db, actor, {
    action: u.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
    entityType: 'user',
    entityId: id,
    previous: { role: before.role_code, active: before.is_active, name: before.full_name },
    next: { role: row.role_code, active: row.is_active, name: row.full_name },
  });
  return row;
}

export async function resetPassword(db: Db, id: string, password: string, actor: Actor) {
  validatePassword(password);
  const row = await q1(db, `UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1 RETURNING id, email`, [id, await hashPassword(password)]);
  if (!row) throw notFound('User');
  await audit(db, actor, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: id, description: row.email });
}

export async function changeOwnPassword(db: Db, userId: string, current: string, next: string, actor: Actor) {
  const u = await q1(db, 'SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) throw validationError('Current password is incorrect.');
  validatePassword(next);
  await db.query('UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1', [userId, await hashPassword(next)]);
  await audit(db, actor, { action: 'USER_PASSWORD_CHANGED', entityType: 'user', entityId: userId });
}
