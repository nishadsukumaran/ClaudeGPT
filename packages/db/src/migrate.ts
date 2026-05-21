/**
 * Apply Drizzle-generated migrations against DATABASE_URL.
 * Run with: `pnpm db:migrate`
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadEnv, getLogger } from '@claudegpt/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = getLogger('db.migrate');

async function main() {
  const env = loadEnv();
  log.info('Starting migration...');

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });

  // Bootstrap required extensions before drizzle migrate.
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  const db = drizzle(pool);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, '..', 'migrations');

  await migrate(db, { migrationsFolder });
  log.info('Migration complete.');

  await pool.end();
}

main().catch((err) => {
  log.error({ err }, 'Migration failed');
  process.exit(1);
});
