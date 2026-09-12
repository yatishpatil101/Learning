import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportSeedCoverage } from './scripts/check-seed-coverage.mjs';

/**
 * Reset `draazy_e2e` to its baseline **before** a live run, not after it.
 *
 * ## Why at the start
 *
 * A teardown only cleans up when the run reaches it, and the runs you most want to inspect are the
 * ones that did not: a crash, a `Ctrl-C`, a machine that slept. Cleaning up at the end therefore
 * gives you the weaker guarantee (usually clean) *and* destroys the evidence in exactly the case
 * where you wanted to open the database and look. Resetting at the start gives the stronger
 * guarantee - every run begins from the same rows, whatever the last one did - and leaves the
 * failure intact until the next run.
 *
 * ## What "baseline" means
 *
 * The three seed scripts the backend itself runs, replayed in Flyway's own order: the permission
 * map and reference data from `db/migration`, then the demo fixtures from `db/seed`. Reusing the
 * backend's files rather than keeping a copy here is the point - a second definition of the fixture
 * contract is a second thing to forget to update, and `docs/system/fixture-registry.md` documents
 * exactly one.
 *
 * ## Deliberately not wired into the no-backend config
 *
 * `playwright.nobackend.config.js` must pass with no backend and no Postgres — that is the whole
 * subject of the three specs left in it. Only the default config imports this.
 */
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
];

function psql(args) {
  // -v ON_ERROR_STOP=1 is the whole reliability story: without it psql reports success after a
  // failed statement, so a broken reset would hand the suite a half-seeded database and every
  // failure downstream would be blamed on the product.
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

  /* Assert the baseline is actually a baseline. The reset above proves the seed RAN; this proves it
     COVERS - i.e. that no table a spec might read was left empty. Placed here rather than in a spec
     because it is a property of the fixture set, not of any one journey, and because failing before
     the first browser opens is the difference between one clear message and N timeouts. */
  reportSeedCoverage();
}
