/**
 * Contract-parity check: mock review provider vs the live API, through the http mapper.
 *
 * `reviewService.js` is a seam — the property page's ratings block, the locality reviews panel and
 * the society hub are written against one interface and must not care which provider answered.
 *
 * What makes this domain worth a harness is that **the wire is stricter than the mock, and the
 * strictness is the product**:
 *
 * 1. **`context` is readOnly.** It is the "Verified resident" / "Visited" badge, derived from the
 *    author's visit and tenancy history. The old write path sent `context: 'visit'` as a literal on
 *    every submission, so on mocks every review certified itself. The mapper must never put it in a
 *    create body, and the badge must survive a round trip unchanged rather than being defaulted.
 * 2. **`recommend` is tri-state.** true / false / **null-meaning-did-not-say**. A `|| null` anywhere
 *    turns a genuine "would not recommend" into "no opinion", which moves the headline percentage
 *    the summary card prints.
 * 3. **`categories` must be an object,** never null: the summary iterates it without a guard.
 * 4. **`at` must be the display date the card prints raw.** An ISO instant renders as
 *    `2026-08-07T09:14:22.117Z` in the middle of a review card — visibly wrong, but only visibly,
 *    so it survives anything that does not actually look at the page.
 *
 * ## This script writes a real, public row — and now removes it again (D100)
 *
 * The round trip below is a genuine `POST /reviews/locality/{slug}`, so until 2026-08-09 every run
 * left "Parity probe review." rendering on `/locality/aundh` to anybody browsing the dev site. It
 * was found the hard way: the first live-reviews e2e asserted on "seeded" Aundh reviews that were
 * in fact four rows this harness had littered — a test whose fixture was another tool's litter.
 *
 * So the run now deletes its own row, and the contract is:
 *
 * - **Keyed on the id the create returned**, never on the body text. A `LIKE 'Parity probe%'` sweep
 *   would take out a *concurrent* run's row on a shared database, which is somebody else's failure.
 * - **Fail safe.** If the delete does not happen, or does not report exactly one row, the run exits
 *   non-zero and prints the id it left behind plus the SQL to remove it by hand. A silent partial
 *   cleanup is worse than none, because it teaches you to stop checking.
 * - **Cleanup runs even when the assertions fail**, so a contract break does not also cost a row.
 * - `--keep` opts out explicitly, and says loudly that it did.
 *
 * Cleanup goes **straight to Postgres via `psql`**, because there is no `DELETE /reviews/{id}` on
 * the API: moderation can hide a review but not remove one, and adding a destructive moderation
 * power to the product so that a test harness can tidy up is the wrong reason to design one. Two
 * alternatives were considered and rejected: pointing the harness at a throwaway database cannot
 * work, because the harness talks to the *backend* over HTTP and the backend chooses the database;
 * and making the probe read-only would drop the only assertion that the write path exists at all.
 *
 * Usage (backend must be running):
 *   node scripts/review-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/review-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * Cleanup knobs — the defaults match `docs/LOCAL_DEV.md`, so normally you pass none:
 *   --db    <uri>   Postgres the backend is using. Default postgresql://postgres:postgres@localhost:5432/punenest
 *                   (or $PARITY_DB_URL). It must be the *same* database, or the delete finds
 *                   nothing and the run fails, which is the intended outcome.
 *   --psql  <path>  psql binary. Default $PARITY_PSQL, then `psql` on PATH, then the Windows
 *                   default C:\Program Files\PostgreSQL\13\bin\psql.exe.
 *   --keep          leave the row. It is public — only do this while debugging. **Pass it last:**
 *                   argv is read in `--flag value` pairs (the convention every parity script here
 *                   shares), so a valueless flag in the middle swallows the next argument.
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree and the probe row is gone, 1 = drift found or the row survived.
 */
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98764${String(Date.now()).slice(-5)}`;
const DB_URL = args.get('db') || process.env.PARITY_DB_URL
  || 'postgresql://postgres:postgres@localhost:5432/punenest';
// What may be printed in its place: host and database kept (you need to see *which* database the
// cleanup ran against), userinfo gone. Split on the last `@`, so a password containing one is still
// fully removed rather than half-shown.
const SAFE_DB_URL = DB_URL.includes('@')
  ? `${DB_URL.slice(0, DB_URL.indexOf('//') + 2)}***@${DB_URL.slice(DB_URL.lastIndexOf('@') + 1)}`
  : DB_URL;

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);

// ─── Sign in ──────────────────────────────────────────────────────────────────────────────────
await api('POST', '/auth/login', { mobile: MOBILE });
const otp = await readOtp(MOBILE);
const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
if (loginRes.status !== 200) {
  console.error(`\n  Live login failed (HTTP ${loginRes.status}): ${JSON.stringify(loginRes.body)}\n`);
  process.exit(1);
}
const token = loginRes.body.accessToken;
const meId = loginRes.body.user?.id;

// A seeded locality: reviews of one need no eligibility, so this exercises the full read/write
// round trip without having to manufacture a completed visit.
const localities = await api('GET', '/localities');
const LOCALITY = localities.body?.content?.[0]?.slug || localities.body?.[0]?.slug;
if (!LOCALITY) {
  console.error('\n  No seeded locality found — cannot exercise the entity review route.\n');
  process.exit(1);
}

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ id: meId, name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token,
  refreshToken: loginRes.body.refreshToken,
}));

const mock = await load('../src/services/providers/mock/reviewProvider.js');
const live = await load('../src/services/providers/http/reviewProvider.js');
const { toReviewCreate, toViewModel } = await load('../src/services/providers/http/reviewMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The create body must not carry the badge ─────────────────────────────────────────────────
const body = toReviewCreate({
  rating: 4,
  text: 'Parity probe review.',
  categories: { locality: 5 },
  recommend: false,
  // Simulating the old modal, which sent these unconditionally. All three are the server's to
  // decide, and `context` is the one that would be a lie rather than merely redundant.
  context: 'tenant',
  user: 'Somebody Else',
  id: 'RV-forged',
});
for (const forbidden of ['context', 'user', 'id', 'targetType', 'targetId', 'at']) {
  if (forbidden in body) {
    failures.push(`toReviewCreate leaked \`${forbidden}\` into the create body — the server owns that field`);
  }
}
if (body.recommend !== false) {
  failures.push('toReviewCreate dropped `recommend: false` — "would not recommend" is an answer, not an absence');
}

// ─── Round trip: write one, read it back ──────────────────────────────────────────────────────
// This is the only destructive thing the harness does. The create is inside the `try` so that a
// throw — a 409 on a re-used `--mobile`, a dropped response after the server committed — still
// reaches the `finally`, which is what turns "the script died" into "and here is the row it left".
let written;
try {
  written = await live.createEntityReview('locality', LOCALITY, {
    rating: 4,
    text: 'Parity probe review.',
    recommend: false,
  });
  if (!written?.id) failures.push('createEntityReview returned no id');

  const page = await live.listEntityReviews('locality', LOCALITY);
  const mine = page.items.find((r) => r.id === written.id);
  if (!mine) {
    failures.push('a review written through the live provider did not come back from listEntityReviews');
  } else {
    // The four view-model invariants the pages depend on.
    if (typeof mine.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(mine.at)) {
      failures.push(`\`at\` must be the YYYY-MM-DD the card prints raw, got ${JSON.stringify(mine.at)}`);
    }
    if (typeof mine.rating !== 'number') failures.push('`rating` must be a number — the summary averages it');
    if (mine.categories == null || typeof mine.categories !== 'object') {
      failures.push('`categories` must be an object — the summary iterates it without a guard');
    }
    if (mine.recommend !== false) {
      failures.push(`\`recommend: false\` did not survive the round trip (got ${JSON.stringify(mine.recommend)}) — a "would not recommend" reported as "did not say" moves the headline percentage`);
    }
    // A locality has no visit or tenancy to evidence, so the server must not invent a badge.
    if (mine.context != null) {
      failures.push(`a locality review came back with context=${JSON.stringify(mine.context)} — there is no visit or tenancy to evidence for a locality`);
    }
    if (!mine.user) failures.push('`user` is empty — the card renders the author name and its initials');
  }

  // ─── Key shape: both providers must answer the same envelope ────────────────────────────────
  const mockPage = await mock.listEntityReviews('locality', LOCALITY);
  for (const k of ['items', 'total', 'page', 'size']) {
    if (!(k in mockPage)) failures.push(`mock listEntityReviews is missing \`${k}\``);
    if (!(k in page)) failures.push(`http listEntityReviews is missing \`${k}\``);
  }
  if (!Array.isArray(mockPage.items) || !Array.isArray(page.items)) {
    failures.push('`items` must be an array on both providers');
  }
} catch (err) {
  // Reported rather than rethrown, so `report()` still prints the cleanup outcome alongside it.
  failures.push(`the live round trip threw: ${String(err?.message || err).split('\n')[0]}`);
} finally {
  // Always — a contract break must not also cost a public row.
  deleteProbeReview(written?.id);
}

// ─── The mock must not fabricate a badge either ───────────────────────────────────────────────
// Mocks are where the screenshots and the demo come from, so a badge that is meaningless there is
// a badge nobody will trust anywhere.
const mockWritten = await mock.createPropertyReview('P-parity', { rating: 5, text: 'x' });
if (mockWritten !== 'login' && mockWritten?.context) {
  failures.push(`the mock review provider stamped context=${JSON.stringify(mockWritten.context)} on write — standing is not the client's to claim, on either provider`);
}

// ─── Null-safety of the mapper ────────────────────────────────────────────────────────────────
if (toViewModel(null) !== null) failures.push('toViewModel(null) must be null, not a half-built object');
const defaults = toViewModel({ id: 'r1', rating: 3 });
if (defaults.categories == null) failures.push('toViewModel must default `categories` to an object');
if (defaults.recommend !== null) failures.push('toViewModel must report a missing `recommend` as null');
if (defaults.context !== null) failures.push('toViewModel must report a missing `context` as null, never a default badge');

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/**
 * Delete the one review this run wrote, and say exactly what is being deleted first.
 *
 * Scoped to the id the server handed back — see the header on why not a text sweep. Every route out
 * of here either deletes exactly one row or pushes a failure carrying the id and the SQL, so
 * `report()` exits non-zero and the leftover is never a surprise discovered on the site.
 */
function deleteProbeReview(reviewId) {
  if (!reviewId) {
    // The POST may still have landed — a response can be lost after the server committed.
    failures.push('no review id was returned, so the probe row (if it was written) could not be removed');
    console.error('\n  Cleanup: no id to delete by. If the POST reached the server the row is:');
    console.error(meId
      // `meId` is itself optional on the login response, and this is the one branch reached when
      // responses are going missing — so do not print SQL with `'undefined'` in it.
      ? `    SELECT id, target_type, target_id, body FROM reviews WHERE author_id = '${meId}';`
      : `    SELECT id, target_type, target_id, body FROM reviews WHERE body = 'Parity probe review.' ORDER BY created_at DESC;`);
    return;
  }
  // The id is interpolated into SQL below, so it has to be an id and nothing else.
  if (!/^[0-9a-fA-F-]{36}$/.test(String(reviewId))) {
    failures.push(`the created review id ${JSON.stringify(reviewId)} is not a uuid — refusing to build SQL from it`);
    return;
  }
  if (args.has('keep')) {
    console.log(`\n  --keep: review ${reviewId} is still in the database and renders publicly on`);
    console.log(`  /locality/${LOCALITY}. Remove it with:`);
    console.log(`    DELETE FROM reviews WHERE id = '${reviewId}';`);
    return;
  }

  const leftBehind = (why) => {
    failures.push(`the probe review ${reviewId} was NOT removed (${why}) — it renders publicly on /locality/${LOCALITY}`);
    console.error(`\n  Cleanup failed: ${why}`);
    console.error('  Remove it by hand — it is public until you do:');
    console.error(`    DELETE FROM reviews WHERE id = '${reviewId}';`);
  };

  const psqlBin = resolvePsql();
  if (!psqlBin) {
    leftBehind('no working psql binary found; pass --psql <path> or set PARITY_PSQL');
    return;
  }

  try {
    const row = runPsql(psqlBin, `SELECT id, target_type, target_id, author_id, rating, status, body FROM reviews WHERE id = '${reviewId}';`);
    console.log(`\n  Cleanup — about to delete from ${redactDbUrl(DB_URL)}:`);
    console.log(`    ${row.trim() || '(no matching row — is --db the database the backend is using?)'}`);

    const deleted = runPsql(psqlBin, `DELETE FROM reviews WHERE id = '${reviewId}' RETURNING id;`);
    // psql prints the `RETURNING` row *and* the command tag ("DELETE 1"), even under `-t`. The tag
    // is the authoritative count, so both are checked: the tag proves one row went, the returned id
    // proves it was this one. Checking only the returned rows would read "DELETE 0" as a row.
    const lines = deleted.split('\n').map((l) => l.trim()).filter(Boolean);
    const tag = lines.find((l) => /^DELETE \d+$/.test(l)) || '(no command tag)';
    const ids = lines.filter((l) => !/^DELETE \d+$/.test(l));
    if (tag !== 'DELETE 1' || ids.length !== 1 || ids[0].toLowerCase() !== String(reviewId).toLowerCase()) {
      leftBehind(`psql answered ${JSON.stringify(tag)} returning ${JSON.stringify(ids)}, expected exactly this one id`);
      return;
    }
    console.log(`  Cleanup: deleted review ${reviewId}.`);
  } catch (err) {
    leftBehind(psqlFailureReason(err));
  }
}

/**
 * Why psql failed, without the connection URI — which carries the password.
 *
 * `execFileSync` builds its `Error.message` as `Command failed: <argv joined by spaces>` followed by
 * the stderr, and the argv contains `-d <DB_URL>`. So the *first line* of that message — the
 * obvious thing to print — is precisely the line with the credential in it, and it also throws away
 * the stderr that says what actually went wrong. Prefer the stderr, and redact whatever is left.
 */
function psqlFailureReason(err) {
  const stderr = String(err?.stderr || '').trim();
  const raw = stderr || String(err?.message || err);
  return redactDbUrl(raw.split('\n').map((l) => l.trim()).filter(Boolean).join('; '));
}

/** First candidate that answers `--version`. `null` if none does, which is a cleanup failure. */
function resolvePsql() {
  const candidates = [
    args.get('psql'),
    process.env.PARITY_PSQL,
    'psql',
    'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // Try the next one — an absent psql is not yet a failure, only an unusable one is.
    }
  }
  return null;
}

/**
 * `-A -t` so the output is the values and nothing else; `ON_ERROR_STOP` so a bad SQL throws.
 *
 * The connection URI goes through `-d`, not as a bare positional. psql takes at most two positional
 * arguments (dbname, username) and *warns and continues* about anything after them — so passing the
 * URI first makes psql ignore `-c` entirely, connect to the default database, and exit 0 with empty
 * output. A cleanup that reports success while deleting nothing is the exact failure this whole
 * change exists to prevent, and it is one character away.
 */
function runPsql(bin, sql) {
  return execFileSync(
    bin,
    ['-d', DB_URL, '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-A', '-t', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/**
 * The URI carries a password; never print it, even a local one.
 *
 * Two passes, because this is also used on error text that may merely *contain* the URI rather than
 * being it. The exact whole-string swap runs first, and it is what makes a password containing a
 * literal `@` safe: it splits on the **last** `@`, so everything before the host goes, whereas the
 * userinfo regex alone stops at the first `@` and would leave the tail of the password visible. The
 * regex then catches any other URI in the same text, and is global because an argv echo repeats it.
 */
function redactDbUrl(text) {
  return String(text)
    .split(DB_URL).join('<db-uri>')
    .replace(/\/\/[^@\s/]*@/g, '//***@');
}

async function api(method, path, payload, bearer) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Same contract as the other parity scripts — see contract-parity.mjs on why there is no OTP endpoint. */
async function readOtp(mobile) {
  const logPath = args.get('otp-log');
  if (logPath) {
    const { readFileSync } = await import('node:fs');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matches = readFileSync(logPath, 'utf8').match(new RegExp(`\\[MOCK OTP\\] mobile=${mobile} code=(\\d+)`, 'g'));
      if (matches) return matches[matches.length - 1].split('code=')[1];
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`No "[MOCK OTP] mobile=${mobile}" line found in ${logPath}`);
  }
  console.log(`\n  Copy the OTP from the backend console line "[MOCK OTP] mobile=${mobile} code=XXXXXX"`);
  process.stdout.write('  OTP: ');
  for await (const line of process.stdin) return line.toString().trim();
  return '';
}

function report() {
  for (const w of warnings) console.log(`  warn: ${w}`);
  if (failures.length) {
    console.error(`\n  FAIL — ${failures.length} contract break(s):`);
    for (const f of failures) console.error(`    - ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log('\n  PASS — mock and live review providers agree on every field the UI relies on.\n');
  process.exit(0);
}

/** Minimal in-memory Web Storage so the providers run outside a browser. */
function installStorageStubs() {
  const make = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    };
  };
  globalThis.localStorage = make();
  globalThis.sessionStorage = make();
  globalThis.window = globalThis;
  globalThis.location ??= new URL(BASE);
  // `lib/mockApi/core.js` subscribes at module scope, and the mock provider reaches it through the
  // store. Node has no DOM event target, so these are the minimum that lets the *real* provider
  // load unmodified — which is the whole point of driving it rather than a reimplementation.
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
  globalThis.dispatchEvent ??= () => {};
}
