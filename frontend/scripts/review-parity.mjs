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
 * Usage (backend must be running):
 *   node scripts/review-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/review-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98764${String(Date.now()).slice(-5)}`;

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
const written = await live.createEntityReview('locality', LOCALITY, {
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

// ─── Key shape: both providers must answer the same envelope ──────────────────────────────────
const mockPage = await mock.listEntityReviews('locality', LOCALITY);
for (const k of ['items', 'total', 'page', 'size']) {
  if (!(k in mockPage)) failures.push(`mock listEntityReviews is missing \`${k}\``);
  if (!(k in page)) failures.push(`http listEntityReviews is missing \`${k}\``);
}
if (!Array.isArray(mockPage.items) || !Array.isArray(page.items)) {
  failures.push('`items` must be an array on both providers');
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
