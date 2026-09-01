/**
 * Runs every `*-parity.mjs` harness in this directory against a live backend, in one command.
 *
 * ## Why this exists
 *
 * The eighteen parity harnesses assert that a mock provider and its http counterpart present the
 * same surface to the components above the seam. None of them are in `npm run check`, and none of
 * them can be: `check` is static, while every harness needs a backend on :8081 and an OTP. So they
 * are only ever run deliberately — and a check nobody runs does not stay true.
 *
 * `serviceRequest-parity.mjs` is the worked example. D119 (`59ab9c7`, 2026-08-09) made
 * `ServiceRequest.details` a round-tripped jsonb object; the harness went on asserting the flat
 * string it replaced. **It was even edited on 2026-08-12 without being run**, so the drift survived
 * a maintainer touching the file. Eleven days later it failed on two assertions that described a
 * contract the repo had reversed, which is worse than no check at all: it costs a cycle to
 * re-derive, and it teaches you to distrust the harness rather than the code.
 *
 * This runner does not fix that on its own — nothing here forces a run. What it removes is the
 * excuse: running all eighteen is now one command with no prompts, so it can ride along with a live
 * e2e session, when the backend is up anyway.
 *
 * ## Usage
 *
 *   node scripts/parity-all.mjs --otp-log %TEMP%\boot8081V.log
 *   node scripts/parity-all.mjs --otp-log <log> --base http://localhost:8081/api
 *   node scripts/parity-all.mjs --only serviceRequest,property
 *
 * **Pass `--otp-log` or this blocks.** Seventeen of the eighteen harnesses prompt on stdin for an
 * OTP otherwise, and a runner that stops on the third of eighteen prompts is worse than running
 * them by hand. The log is the backend's console output, which carries
 * `[MOCK OTP] mobile=… code=……` under the dev and e2e profiles.
 * (`property-parity.mjs` is the exception — it reads public data and never signs in.)
 *
 * Harnesses run **sequentially, never in parallel**: they sign in, write rows and read them back
 * against one shared database, so overlapping runs would read each other's writes.
 *
 * Exit code 0 = every harness agreed, 1 = at least one reported drift.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const otpLog = args.get('otp-log');
const base = args.get('base');
const only = args.get('only')?.split(',').map((s) => s.trim()).filter(Boolean);

const harnesses = readdirSync(HERE)
  .filter((f) => f.endsWith('-parity.mjs'))
  .filter((f) => !only || only.includes(f.replace('-parity.mjs', '')))
  .sort();

if (!harnesses.length) {
  console.error(`\n  No harnesses matched${only ? ` --only ${only.join(',')}` : ''}.\n`);
  process.exit(1);
}
if (!otpLog) {
  console.warn('\n  warn: no --otp-log given, so each harness will stop and ask for an OTP on stdin.');
}

const passThrough = [];
if (otpLog) passThrough.push('--otp-log', otpLog);
if (base) passThrough.push('--base', base);

console.log(`\n  Running ${harnesses.length} parity harness(es) sequentially.\n`);

const results = [];
for (const file of harnesses) {
  const name = file.replace('-parity.mjs', '');
  process.stdout.write(`  ${name.padEnd(16)} … `);
  const started = Date.now();
  // `inherit` for stdin so the OTP prompt still works when --otp-log was not given.
  const run = spawnSync(process.execPath, [join(HERE, file), ...passThrough], {
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = run.status === 0;
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  // A harness that threw before it finished asserting has NOT found drift — it found a broken
  // environment, and reporting the two as one number is how a red suite gets waved through. The
  // tells are all environmental: the mock store is seeded by `ensureMockDb()` and several
  // harnesses read a mock provider without awaiting it; `import.meta.env` does not exist outside
  // Vite; an account that was never created in *this* database never gets an OTP; and a harness
  // that psqls into `punenest` while the API writes `punenest_e2e` deletes nothing.
  const blocked = !ok && (
    /puneNestDB_v5"?\]? is missing/.test(output)
    || /reading 'DEV'/.test(output)
    || /No "\[MOCK OTP\]/.test(output)
    || /psql answered/.test(output)
  );
  results.push({ name, ok, blocked, output });
  console.log(`${ok ? 'PASS' : blocked ? 'BLOCKED' : 'FAIL'}  (${secs}s)`);
}

const failed = results.filter((r) => !r.ok);
const drifted = failed.filter((r) => !r.blocked);
const blocked = failed.filter((r) => r.blocked);

// Only failing harnesses get their output printed. A passing one has nothing to say that the
// PASS line above has not already said, and eighteen transcripts would bury the two that matter.
for (const r of failed) {
  console.error(`\n${'─'.repeat(78)}\n  ${r.name}\n${'─'.repeat(78)}`);
  console.error(r.output.trimEnd());
}

console.log(`\n  ${results.length - failed.length}/${results.length} agreed.`);
if (blocked.length) {
  console.error(`  Could not run (environment, not drift): ${blocked.map((r) => r.name).join(', ')}`);
}
if (drifted.length) {
  console.error(`  Drift in: ${drifted.map((r) => r.name).join(', ')}`);
}
if (failed.length) {
  console.error('');
  process.exit(1);
}
console.log('  Every provider pair agrees on the surface its components rely on.\n');
