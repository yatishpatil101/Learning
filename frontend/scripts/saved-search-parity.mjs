/**
 * Contract-parity check: mock saved-search provider vs the live API.
 *
 * `savedSearchService.js` absorbs two real shape gaps, and both fail *silently* if they drift —
 * which is why this checks values, not just types:
 *
 * 1. **Flat facets vs nested `filters`.** Every consumer reads `rec.deal`, `rec.bhk`,
 *    `rec.localities` straight off the record. If a provider stops flattening the server's
 *    `filters` jsonb, those become `undefined` and `criteriaChips` renders nothing. No error — just
 *    an alert that quietly describes the wrong search.
 *
 * 2. **`alerts` boolean vs `alertFrequency` enum.** The Switch and two `s.alerts !== false` guards
 *    depend on the derived boolean. If it goes missing, `undefined !== false` is true, so a
 *    disabled alert starts firing again.
 *
 * 3. **`matchCount` / `newCount` (D227).** Both are read as `s.matchCount ?? 0`, so a provider that
 *    stops supplying them does not fail — it reports zero matches, and zero matches removes the
 *    alert from the retention strip and the inbox altogether.
 *
 * Usage (backend must be running):
 *   node scripts/saved-search-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/saved-search-parity.mjs --base http://localhost:8080/api   (prompts for the OTP)
 *
 * **The base must include `/api`.** Exit 0 = shapes match, 1 = drift.
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;

installStorageStubs();

const failures = [];
const warnings = [];

/** The record every call site builds — flat facets, exactly as `buildAlertRecord` emits them. */
const RECORD = {
  deal: 'rent',
  types: ['apartment'],
  bhk: ['2'],
  localities: ['baner'],
  rent: [10000, 40000],
  label: 'Apartment · 2 BHK · Rent · Baner',
  query: 'Apartment 2 BHK Baner',
  channel: 'whatsapp',
};

// ─── Drive the live API ───────────────────────────────────────────────────────────────────────
await api('POST', '/auth/login', { mobile: MOBILE });
const otp = await readOtp(MOBILE);
const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
if (loginRes.status !== 200) {
  console.error(`\n  Live login failed (HTTP ${loginRes.status}): ${JSON.stringify(loginRes.body)}\n`);
  process.exit(1);
}
const token = loginRes.body.accessToken;

// The http provider authenticates out of localStorage, exactly as the browser does, so the session
// has to be installed before any provider call. Same two keys `become()` writes in
// flatmate-parity.mjs; without them every provider read here would 401 and read as drift.
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({
  id: loginRes.body.user?.id, name: 'Parity Probe', mobile: MOBILE, role: 'buyer',
}));
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token, refreshToken: loginRes.body.refreshToken,
}));

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

const httpProvider = await load('../src/services/providers/http/savedSearchProvider.js');
// Both directions go through the provider, because both of its mappers are the thing under test:
// `toCreateRequest` on the way out and `toViewModel` on the way back.
//
// Until 2026-08-21 this called the raw endpoint with a hand-built body and then re-implemented
// `toViewModel` locally to read the reply. That grades a *copy* of the mapper, not the mapper — and
// the copy duly drifted: it never learned `matchCount` or `newCount`, so it reported the live
// provider missing the two fields the provider has mapped ever since D227 shipped. Two false
// failures, and, worse, no real coverage at all of the fields gap 3 below is named after. A mapper
// can only be checked by running it.
const liveCreated = await httpProvider.createSavedSearch(RECORD).catch((e) => {
  console.error(`\n  Live create failed: ${e?.status ?? ''} ${JSON.stringify(e?.body ?? e?.message)}\n`);
  process.exit(1);
});
const liveId = liveCreated.id;
const liveView = (await httpProvider.listSavedSearches()).find((r) => r.id === liveId) || null;

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
const mock = await load('../src/services/providers/mock/savedSearchProvider.js');
const mockCreated = await mock.createSavedSearch({ ...RECORD });
const mockView = (await mock.listSavedSearches()).find((s) => s.id === mockCreated.id);

// ─── Diff ─────────────────────────────────────────────────────────────────────────────────────
if (!liveView || !mockView) {
  failures.push('one side did not return the row it had just created');
} else {
  // Gap 1: the facets must survive the round trip on BOTH sides, flat and equal.
  for (const facet of ['deal', 'types', 'bhk', 'localities', 'rent']) {
    const expected = JSON.stringify(RECORD[facet]);
    if (JSON.stringify(mockView[facet]) !== expected) {
      failures.push(`${facet}: mock returned ${JSON.stringify(mockView[facet])}, expected ${expected} — facets not flat`);
    }
    if (JSON.stringify(liveView[facet]) !== expected) {
      failures.push(`${facet}: live returned ${JSON.stringify(liveView[facet])}, expected ${expected} — filters not flattened`);
    }
  }

  // Gap 2: both representations of the alert state, present and agreeing.
  for (const [label, view] of [['mock', mockView], ['live', liveView]]) {
    if (typeof view.alerts !== 'boolean') {
      failures.push(`alerts: ${label} is ${typeof view.alerts}, expected boolean — a disabled alert would start firing`);
    }
    if (typeof view.alertFrequency !== 'string') {
      failures.push(`alertFrequency: ${label} is ${typeof view.alertFrequency}, expected string`);
    }
    if (view.alerts !== (view.alertFrequency !== 'off')) {
      failures.push(`${label}: alerts=${view.alerts} disagrees with alertFrequency="${view.alertFrequency}"`);
    }
  }

  for (const field of ['id', 'kind', 'label', 'channel']) {
    if (typeof mockView[field] !== 'string') failures.push(`${field}: mock is ${typeof mockView[field]}, expected string`);
    if (typeof liveView[field] !== 'string') failures.push(`${field}: live is ${typeof liveView[field]}, expected string`);
  }

  /* Gap 3: the two counts (D227). Neither is compared value-for-value — the mock counts its demo
     catalogue and the server counts the e2e database, and those are different catalogues. What must
     hold on both sides is that the fields are *numbers*, because every consumer reads them as
     `s.matchCount ?? 0`: a missing field is not an error, it is a confident zero, and a zero
     suppresses the retention strip and the inbox row entirely. That is exactly the silent drift this
     harness exists to catch. `newCount` is checked alongside it because it fails the same way. */
  for (const [label, view] of [['mock', mockView], ['live', liveView]]) {
    for (const field of ['matchCount', 'newCount']) {
      if (typeof view[field] !== 'number') {
        failures.push(`${field}: ${label} is ${typeof view[field]}, expected number — a missing count reads as a confident zero and hides the alert`);
      }
    }
  }
  // A search saved a moment ago has nothing new by definition, on either side.
  for (const [label, view] of [['mock', mockView], ['live', liveView]]) {
    if (view.newCount !== 0) warnings.push(`newCount: ${label} returned ${view.newCount} for a search created just now`);
  }

  /* Gap 3b: the same two fields, on the wire this time.
     The check above cannot fail for the live side, and it is worth being explicit about why rather
     than deleting it: `toViewModel` reads them as `row.matchCount ?? 0`, so a *server* that stopped
     sending the field is coerced to a number before the assertion ever sees it. That `?? 0` is
     deliberate and correct — it is what keeps the UI working against an older server — but it means
     gap 3 grades only the mapper. The field going missing at the source is the more likely drift of
     the two (it is one `@Mapping` or one renamed column away), and it produces exactly the failure
     D227 was raised to stop: a confident zero that empties the retention strip. So assert it where
     the coercion cannot reach — on the raw response body. */
  const wire = (await api('GET', '/me/saved-searches', null, token)).body;
  const wireRow = (Array.isArray(wire) ? wire : []).find((r) => r.id === liveId);
  if (!wireRow) {
    failures.push('the row just created is absent from the raw GET /me/saved-searches body');
  } else {
    for (const field of ['matchCount', 'newCount']) {
      if (typeof wireRow[field] !== 'number') {
        failures.push(`${field}: the server sent ${typeof wireRow[field]}, expected number — the provider's \`?? 0\` would mask this as a confident zero and empty the retention strip (D227)`);
      }
    }
  }
}

// The off→on round trip the Switch performs, checked against the server rather than assumed.
if (liveId) {
  const off = await api('PATCH', `/me/saved-searches/${liveId}`, { alertFrequency: 'off' }, token);
  if (off.body?.alertFrequency !== 'off') failures.push(`update: live returned alertFrequency="${off.body?.alertFrequency}" after setting off`);
  const on = await api('PATCH', `/me/saved-searches/${liveId}`, { alertFrequency: 'daily' }, token);
  if (on.body?.alertFrequency !== 'daily') failures.push(`update: live returned alertFrequency="${on.body?.alertFrequency}" after setting daily`);
}

const mockOff = await mock.updateSavedSearch(mockCreated.id, { alertFrequency: 'off' });
if (mockOff?.alerts !== false) failures.push('update: mock did not clear `alerts` when alertFrequency was set to off');

// ─── Clean up ─────────────────────────────────────────────────────────────────────────────────
if (liveId) {
  const del = await api('DELETE', `/me/saved-searches/${liveId}`, null, token);
  if (del.status !== 204) failures.push(`delete: live returned HTTP ${del.status}, expected 204`);
}
await mock.deleteSavedSearch(mockCreated.id);
if ((await mock.listSavedSearches()).some((s) => s.id === mockCreated.id)) {
  failures.push('delete: mock did not remove the row');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

// `buildCreateBody` and `viewModelOf` lived here until 2026-08-21. They were hand-written copies of
// the provider's own `toCreateRequest` / `toViewModel`, kept because "the provider does not export
// its mappers" — but the provider's public functions call them, so the mappers were reachable all
// along. Both copies are now deleted rather than repaired: a second implementation of a mapper is a
// second thing to keep in step, and this one silently stopped being in step.

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
    console.log('  PASS — mock and live saved-search providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
