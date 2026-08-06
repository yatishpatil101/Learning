/**
 * Contract-parity check: mock visit provider vs the live API.
 *
 * The visit slice has one translation that fails *silently* if it drifts, and it is a timezone bug
 * rather than a missing field: the server carries a slot as a single ISO instant, while the whole
 * dashboard reads a human `when` string through `parseWhen`. If `slotFromParts` / `whenFromSlot`
 * stop round-tripping, a 10:30 AM visit still renders — just on the wrong day, or at the wrong
 * hour, with nothing thrown. So this asserts the round trip explicitly rather than only checking
 * that a `when` field exists.
 *
 * It also pins the duplicate-visit rule. The mock used to silently move an existing visit's slot
 * while the server 409s; both now refuse, and a regression either way is a UI written against
 * behaviour the other side does not have.
 *
 * Usage (backend must be running):
 *   node scripts/visit-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/visit-parity.mjs --base http://localhost:8080/api   (prompts for the OTP)
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

// ─── The slot round trip, checked before anything touches the network ─────────────────────────
// A pure-function check, so it fails fast and points at the conversion rather than at a request.
//
// Deliberately uses a FUTURE date. `parseWhen` extracts only day + month from the human string and
// reconstructs the year from "now", rolling forward when the result would be in the past — so a
// past date does not round-trip its year (D88). Every visit the calendar sorts is upcoming, which
// is the case this asserts.
const { slotFromParts, whenFromSlot, parseWhen } = await import('../src/lib/visitWhen.js');
{
  const dateIso = futureDateIso();
  const [y, mo, dd] = dateIso.split('-').map(Number);
  const time = '10:30 AM';
  const slot = slotFromParts(dateIso, time);
  const back = parseWhen(whenFromSlot(slot, 'in-person'));
  if (back.timeLabel !== time) {
    failures.push(`slot round trip: "${time}" came back as "${back.timeLabel}" — a visit would display at the wrong hour`);
  }
  const d = back.date;
  const sameDay = d && d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === dd;
  if (!sameDay) {
    failures.push(`slot round trip: ${dateIso} came back as ${d ? d.toDateString() : 'null'} — a visit would display on the wrong day`);
  }
  if (parseWhen(whenFromSlot(slot, 'video')).mode !== 'video') {
    failures.push('slot round trip: mode did not survive');
  }
}

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

const slot = slotFromParts(futureDateIso(), '10:30 AM');
const created = await api('POST', '/visits', { propertyId: liveProperty.id, slot, mode: 'in-person' }, token);
if (created.status !== 201) {
  console.error(`\n  Live schedule failed (HTTP ${created.status}): ${JSON.stringify(created.body)}\n`);
  process.exit(1);
}
const liveId = created.body.id;

// The duplicate rule: a second live visit on the same property must be refused, not absorbed.
const dup = await api('POST', '/visits', { propertyId: liveProperty.id, slot, mode: 'in-person' }, token);
if (dup.status !== 409) {
  failures.push(`duplicate visit: live returned HTTP ${dup.status}, expected 409 — the mock refuses, so a caller written against one would break on the other`);
}

const liveList = await api('GET', '/visits', null, token);
const liveRaw = (Array.isArray(liveList.body) ? liveList.body : []).find((v) => v.id === liveId);

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
const mock = await import('../src/services/providers/mock/visitProvider.js');
const { rawDb } = await import('../src/lib/mockApi.js');
const mockProperty = (rawDb().listings || []).find((p) => p.ownerMobile);
if (!mockProperty) {
  console.error('\n  The mock database has no listing with an ownerMobile.\n');
  process.exit(1);
}

const mockCreated = await mock.scheduleVisit({
  propertyId: mockProperty.id,
  listing: mockProperty.title,
  dateIso: futureDateIso(),
  time: '10:30 AM',
  mode: 'in-person',
});

let mockDupRefused = false;
try {
  await mock.scheduleVisit({ propertyId: mockProperty.id, dateIso: futureDateIso(), time: '10:30 AM', mode: 'in-person' });
} catch (e) {
  mockDupRefused = e?.status === 409;
}
if (!mockDupRefused) {
  failures.push('duplicate visit: the mock accepted a second live visit — the server returns 409');
}

const mockView = (await mock.listVisits()).find((v) => v.id === mockCreated.id);
const liveView = liveRaw ? viewOf(liveRaw) : null;

// ─── Diff ─────────────────────────────────────────────────────────────────────────────────────
if (!mockView || !liveView) {
  failures.push('one side did not return the visit it had just created');
} else {
  for (const field of ['id', 'propertyId', 'listingId', 'when', 'mode', 'status', 'visitorName']) {
    if (typeof mockView[field] !== 'string') failures.push(`${field}: mock is ${typeof mockView[field]}, expected string`);
    if (typeof liveView[field] !== 'string') failures.push(`${field}: live is ${typeof liveView[field]}, expected string`);
  }
  // `when` must be parseable on both sides — it is what the calendar groups and sorts on.
  for (const [label, view] of [['mock', mockView], ['live', liveView]]) {
    if (!parseWhen(view.when).date) {
      failures.push(`when: ${label} produced "${view.when}", which parseWhen cannot read — the visit would vanish from the calendar`);
    }
  }
  if (mockView.status !== 'scheduled') failures.push(`status: mock created a visit as "${mockView.status}", expected "scheduled"`);
  if (liveView.status !== 'scheduled') failures.push(`status: live created a visit as "${liveView.status}", expected "scheduled"`);
}

// ─── Clean up ─────────────────────────────────────────────────────────────────────────────────
if (liveId) {
  const cancelled = await api('PATCH', `/visit-requests/${liveId}/status`, { status: 'cancelled' }, token);
  if (cancelled.status !== 200) failures.push(`updateVisitStatus: live returned HTTP ${cancelled.status}, expected 200`);
}
await mock.updateVisitStatus(mockCreated.id, 'cancelled');
const afterCancel = (await mock.listVisits()).find((v) => v.id === mockCreated.id);
if (afterCancel && afterCancel.status !== 'cancelled') {
  failures.push('updateVisitStatus: the mock did not persist the cancelled status');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** A date far enough ahead that the visit is unambiguously upcoming. */
function futureDateIso() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Wire row → the seam's shape, mirroring providers/http/visitProvider.js. */
function viewOf(row) {
  const mode = row?.mode || 'in-person';
  return {
    id: row.id,
    propertyId: row.propertyId || '',
    listingId: row.propertyId || '',
    listing: row.listing || '',
    when: whenFromSlot(row.slot, mode),
    mode,
    status: row.status || 'scheduled',
    visitorName: row.visitor?.name || 'Visitor',
    visitorMobile: row.visitor?.mobile || '',
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
    console.log('  PASS — mock and live visit providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
