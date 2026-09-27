import { pool } from '../../src/db/pool';
import { runMigrations } from '../migrate';
import { seedDemoData } from './demoSeed';

/** Applies pending migrations, then replaces all data with the synthetic demo dataset. */
runMigrations()
  .then(() => seedDemoData())
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
