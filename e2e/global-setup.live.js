import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportSeedCoverage } from './scripts/check-seed-coverage.mjs';

/** Resets `draazy_e2e` before, not after, a live run: an end-of-run teardown is skipped on a crash or Ctrl-C and
 * would erase the evidence. Not imported by the no-backend config, which must run with no Postgres. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const RESOURCES = path.join(REPO, 'backend', 'src', 'main', 'resources', 'db');

// Not on PATH in a default Windows install, so the full path is the working default and the
// variable is the escape hatch for anyone whose layout differs.
const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';
const DB = process.env.E2E_DB_NAME || 'draazy_e2e';
const USER = process.env.E2E_DB_USER || 'postgres';

/** Seeds in Flyway's order: reference data before the fixtures that point at it. */
const SEEDS = [
  path.join(RESOURCES, 'migration', 'R__DML_seed_permission_map.sql'),
  path.join(RESOURCES, 'migration', 'R__DML_seed_reference_data.sql'),
  path.join(RESOURCES, 'seed', 'R__zz_DML_dev_demo_data.sql'),
  path.join(RESOURCES, 'seed', 'R__zz_DML_dev_live_localities.sql'),
  path.join(RESOURCES, 'seed-staff', 'R__zz_DML_dev_staff_credentials.sql'),
];

function psql(args) {
  // -v ON_ERROR_STOP=1: without it psql exits 0 after a failed statement, leaving a half-seeded database.
  return execFileSync(
    PSQL,
    ['-U', USER, '-d', DB, '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-q', ...args],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

export default function resetE2eDatabase() {
  if (process.env.E2E_SKIP_RESET === '1') {
    console.log('[live] E2E_SKIP_RESET=1 - keeping the database as it is.');
    return;
  }
  if (!existsSync(PSQL)) {
    throw new Error(
      `[live] psql not found at ${PSQL}. Set PSQL to its full path, or E2E_SKIP_RESET=1 to run ` +
        'against the database as it stands.',
    );
  }

  const started = Date.now();
  psql(['-f', path.join(HERE, 'scripts', 'reset-e2e-db.sql')]);
  for (const seed of SEEDS) psql(['-f', seed]);

  const users = psql(['-At', '-c', 'select count(*) from users']).trim();
  console.log(`[live] ${DB} reset to baseline in ${Date.now() - started}ms (${users} users).`);

  /* Proves the seed covers every table a spec reads; failing here gives one clear message, not N timeouts. */
  reportSeedCoverage();
}
