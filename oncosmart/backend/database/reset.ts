import { pool } from '../src/db/pool';
import { runMigrations } from './migrate';
import { seedDemoData } from './seed/demoSeed';

/**
 * DESTRUCTIVE: drops every OncoSmart table in the configured database, re-applies
 * migrations and loads synthetic demo data. For development / demo use only.
 */
async function reset() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    for (const { tablename } of tables.rows) await client.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    const seqs = await client.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`);
    for (const { sequence_name } of seqs.rows) await client.query(`DROP SEQUENCE IF EXISTS "${sequence_name}" CASCADE`);
    await client.query('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');
    await client.query('DROP FUNCTION IF EXISTS audit_logs_immutable() CASCADE');
    await client.query('COMMIT');
    console.log('[reset] dropped existing tables');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await runMigrations();
  await seedDemoData();
}

reset()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
