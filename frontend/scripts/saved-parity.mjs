/**
 * Contract-parity check: mock saved provider vs the live API.
 *
 * `savedService.js` is a seam — the results card, the navbar badge, the Saved page and the
 * dashboard preview are all written against one interface and must not care which provider is
 * wired in. That only holds if both return the *same shape*.
 *
 * The field that matters most here is `items[].id`. `SavedContext` builds its membership Set from
 * it, and every heart in the app is drawn by asking that Set. If the two providers disagree about
 * where the id lives — or the http one returns raw `PropertySummary` rows that were never put
 * through the property mapper — the Set fills with `undefined`, every heart renders empty, and the
 * app looks like it simply lost the user's shortlist. Nothing throws.
 *
 * This drives the real `providers/mock/savedProvider.js`, so drift in the mock is caught too.
 * Browser storage is stubbed in-memory below.
 *
 * Usage (backend must be running):
 *   node scripts/saved-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/saved-parity.mjs --base http://localhost:8080/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes match, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;

installStorageStubs();

const failures = [];
const warnings = [];

// ─── Drive the live API ───────────────────────────────────────────────────────────────────────
await api('POST', '/auth/login', { mobile: MOBILE });
const otp = await readOtp(MOBILE);
const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
if (loginRes.status !== 200) {
  console.error(`\n  Live login failed (HTTP ${loginRes.status}): ${JSON.stringify(loginRes.body)}\n`);
  process.exit(1);
}
const token = loginRes.body.accessToken;

const search = await api('GET', '/properties?size=1', null, token);
const liveProperty = search.body?.content?.[0];
if (!liveProperty) {
  console.error('\n  No listings returned by GET /properties — seed the database first.\n');
  process.exit(1);
}

// A fresh account starts with an empty shortlist, so save one to have a row to compare. Both
// writes are idempotent, so re-running this script does not accumulate anything.
const putRes = await api('PUT', `/me/saved/${liveProperty.id}`, null, token);
if (putRes.status !== 204) failures.push(`saveProperty: live returned HTTP ${putRes.status}, expected 204`);

// Idempotence is a contract claim, not an assumption — a double-tap must not 409 or duplicate.
const putAgain = await api('PUT', `/me/saved/${liveProperty.id}`, null, token);
if (putAgain.status !== 204) failures.push(`saveProperty (repeat): live returned HTTP ${putAgain.status}, expected 204 — not idempotent`);

const liveList = (await api('GET', '/me/saved?size=500', null, token)).body;
// `PageEnvelope` names the current page `page`. Reading Spring's raw `number` here reported the
// provider's field as missing when it was the harness looking in the wrong place.
const liveUnwrapped = { items: liveList?.content ?? [], total: liveList?.totalElements, page: liveList?.page, size: liveList?.size };

if (liveUnwrapped.items.filter((p) => p.id === liveProperty.id).length !== 1) {
  failures.push('saveProperty is not idempotent: the shortlist does not contain exactly one copy after two saves');
}

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────
// Plain `await import()` no longer reaches these modules: the mock provider pulls in `mockApi/core`,
// which imports `db.json` (Node >= 22 demands an import attribute) and `persist.js` (which reads
// `import.meta.env.DEV`, undefined outside a bundler). Vite resolves both, and it is what the
// review/support/report harnesses already use — so this is the one loader all seven now share.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

const mock = await load('../src/services/providers/mock/savedProvider.js');
const { rawDb } = await load('../src/lib/mockApi.js');
const mockProperty = rawDb().listings[0];
if (!mockProperty) {
  console.error('\n  The mock database has no listings.\n');
  process.exit(1);
}

await mock.saveProperty(mockProperty.id);
await mock.saveProperty(mockProperty.id); // idempotence, mock side
const mockList = await mock.listSaved({ size: 500 });

if (mockList.items.filter((p) => p.id === mockProperty.id).length !== 1) {
  failures.push('saveProperty is not idempotent on the mock: saving twice did not leave exactly one copy');
}

// ─── Diff ─────────────────────────────────────────────────────────────────────────────────────
for (const [field, type] of Object.entries({ items: 'object', total: 'number', page: 'number', size: 'number' })) {
  checkType('listSaved', field, type, mockList?.[field], liveUnwrapped?.[field]);
}

// The row itself. `id` is load-bearing (see the header); the rest are what a card renders, and a
// card with no title or price is indistinguishable from a broken listing.
const mockRow = mockList.items[0];
const liveRow = liveUnwrapped.items[0];
if (mockRow && liveRow) {
  checkType('listSaved.items[]', 'id', 'string', mockRow.id, liveRow.id);
  for (const field of ['title', 'deal', 'locality']) {
    checkType('listSaved.items[]', field, 'string', mockRow[field], liveRow[field]);
  }
  checkType('listSaved.items[]', 'price', 'number', mockRow.price, liveRow.price);
} else {
  warnings.push('row shape not compared — one or both shortlists were empty after a save, which is itself suspicious');
}

// ─── Clean up ─────────────────────────────────────────────────────────────────────────────────
// Leave the live account as found. Unsave is idempotent, so this is safe even if the save failed.
const delRes = await api('DELETE', `/me/saved/${liveProperty.id}`, null, token);
if (delRes.status !== 204) failures.push(`unsaveProperty: live returned HTTP ${delRes.status}, expected 204`);
const delAgain = await api('DELETE', `/me/saved/${liveProperty.id}`, null, token);
if (delAgain.status !== 204) failures.push(`unsaveProperty (repeat): live returned HTTP ${delAgain.status}, expected 204 — not idempotent`);

await mock.unsaveProperty(mockProperty.id);
const mockAfter = await mock.listSaved({ size: 500 });
if (mockAfter.items.some((p) => p.id === mockProperty.id)) failures.push('unsaveProperty did not remove the row on the mock');

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function checkType(scope, field, type, mockValue, liveValue) {
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'object' : typeof v);
  if (typeOf(mockValue) !== type) failures.push(`${scope}.${field}: mock is ${typeOf(mockValue)}, expected ${type}`);
  if (typeOf(liveValue) !== type) failures.push(`${scope}.${field}: live is ${typeOf(liveValue)}, expected ${type}`);
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Same contract as contract-parity.mjs — see the note there on why there is no OTP endpoint. */
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

/** Minimal in-memory Web Storage so the mock provider runs outside a browser. */
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
  // `services/config.js` compares `API_BASE` against the page origin. `window = globalThis` gives a
  // `window` that passes a `typeof` check but has no `location`, which is a worse lie than having no
  // window at all — so give it one, matching the base this run actually targets.
  globalThis.location ??= new URL(BASE);
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener ??= () => {};
  globalThis.dispatchEvent = () => {};
}

function report() {
  console.log('');
  if (warnings.length) {
    console.log(`  ${warnings.length} tolerated difference(s):`);
    warnings.forEach((w) => console.log(`    ~ ${w}`));
    console.log('');
  }
  if (!failures.length) {
    console.log('  PASS — mock and live saved providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
