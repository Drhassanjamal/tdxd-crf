import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db/pool';
import { BACKEND_ROOT } from '../src/config/env';

/**
 * Minimal, transparent SQL migration runner.
 * Applies database/migrations/*.sql in lexical order, once each, inside a transaction.
 */
export async function runMigrations(log = console.log) {
  const dir = path.join(BACKEND_ROOT, 'database', 'migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`[migrate] applied ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (count === 0) log('[migrate] database is up to date');
  return count;
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
