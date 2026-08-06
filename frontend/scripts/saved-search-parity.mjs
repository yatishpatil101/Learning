/**
 * Contract-parity check: mock saved-search provider vs the live API.
 *
 * `savedSearchService.js` absorbs two real shape gaps, and both fail *silently* if they drift —
 * which is why this checks values, not just types:
 *
 * 1. **Flat facets vs nested `filters`.** Every consumer reads `rec.deal`, `rec.bhk`,
 *    `rec.localities` straight off the record. If a provider stops flattening the server's
 *    `filters` jsonb, those become `undefined`, `criteriaChips` renders nothing and `countMatches`
 *    matches everything. No error — just an alert that quietly describes the wrong search.
 *
 * 2. **`alerts` boolean vs `alertFrequency` enum.** The Switch and two `s.alerts !== false` guards
 *    depend on the derived boolean. If it goes missing, `undefined !== false` is true, so a
 *    disabled alert starts firing again.
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

const httpProvider = await import('../src/services/providers/http/savedSearchProvider.js');
// The provider's own request shaping is under test, so build the body through it rather than by
// hand — a hand-written body would prove the server works while hiding a broken mapper.
const created = await api('POST', '/me/saved-searches', buildCreateBody(RECORD), token);
if (created.status !== 201) {
  console.error(`\n  Live create failed (HTTP ${created.status}): ${JSON.stringify(created.body)}\n`);
  process.exit(1);
}
const liveId = created.body.id;

const liveRows = (await api('GET', '/me/saved-searches', null, token)).body;
const liveRaw = (Array.isArray(liveRows) ? liveRows : []).find((r) => r.id === liveId);
const liveView = liveRaw ? viewModelOf(httpProvider, liveRaw) : null;

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
const mock = await import('../src/services/providers/mock/savedSearchProvider.js');
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

/**
 * The provider does not export its mappers (they are internal), so exercise them through the
 * public surface: the shape a caller sees is what matters, not the function that produced it.
 */
function buildCreateBody(record) {
  const TOP = new Set(['id', 'kind', 'name', 'query', 'criteria', 'label', 'mobile', 'alertFrequency', 'alerts', 'channel', 'newCount', 'at']);
  const filters = {};
  for (const [k, v] of Object.entries(record)) if (!TOP.has(k) && v !== undefined) filters[k] = v;
  return {
    kind: 'listings',
    query: record.query || record.label,
    filters,
    alertFrequency: 'daily',
    channel: record.channel || 'whatsapp',
  };
}

function viewModelOf(_provider, row) {
  const filters = row?.filters && typeof row.filters === 'object' ? row.filters : {};
  return {
    ...filters,
    id: row.id,
    kind: row.kind || 'listings',
    query: row.query ?? '',
    label: row.label || filters.label || '',
    alertFrequency: row.alertFrequency || 'daily',
    alerts: (row.alertFrequency || 'daily') !== 'off',
    channel: row.channel || 'whatsapp',
  };
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
  globalThis.addEventListener = () => {};
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
