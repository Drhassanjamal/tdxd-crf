import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { env } from '../config/env';

// Type parsing: NUMERIC -> number, BIGINT -> number, DATE -> 'YYYY-MM-DD' string.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error', err.message);
});

/** Anything that can run a query: the pool or a transaction client. */
export interface Db {
  query: PoolClient['query'];
}

export async function q<T extends QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function q1<T extends QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(db, text, params);
  return rows[0] ?? null;
}

/** Run fn inside a single transaction. Rolls back on any thrown error. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
