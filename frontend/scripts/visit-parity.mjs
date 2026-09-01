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
import { assertLoopbackBase } from './lib-assert-local-base.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;

/** Refuse a `--base` that is not loopback — the shared test lives in `lib-assert-local-base.mjs`. */
assertLoopbackBase(
  BASE,
  args.has('i-know-what-im-doing'),
  'This harness signs in with a real OTP and books visits, so it may only run against a'
  + '\n  backend on this machine.',
);

installStorageStubs();

const failures = [];
const warnings = [];

// ─── The slot round trip, checked before anything touches the network ─────────────────────────
// A pure-function check, so it fails fast and points at the conversion rather than at a request.
//
// Uses a future date for the live round trip (every visit the calendar sorts is upcoming) and,
// since D88, a past date for the year check below: `parseWhen` now reads the year the string carries
// rather than reconstructing it from "now", so a past-year visit round-trips its year intact.
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

const { slotFromParts, whenFromSlot, parseWhen } = await load('../src/lib/visitWhen.js');
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
  // The `when` string carries its own year, and parseWhen must read it back rather than reconstruct
  // it from "now" (D88). A completed visit in a past year is the case the reconstruction got wrong —
  // it rendered a year in the future — so assert a past year survives the round trip intact.
  const pastWhen = whenFromSlot(slotFromParts('2023-01-15', time), 'in-person');
  const pastBack = parseWhen(pastWhen);
  if (!pastBack.date || pastBack.date.getFullYear() !== 2023) {
    failures.push(`year round trip: "${pastWhen}" came back as ${pastBack.date ? pastBack.date.getFullYear() : 'null'} — a past-year visit would display in the wrong year (D88)`);
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

/* `GET /visits` is paged (D77): the body is `{content: [...]}`, not an array. Reading it with
   `Array.isArray(body) ? body : []` yields an empty list *silently*, and both reads below did — so
   the harness reported "one side did not return the visit it had just created" and "the live visit
   vanished after a reschedule" when the server had returned both perfectly well and the harness had
   thrown the page away. It is the same envelope mistake `unwrapPage` exists to stop in the
   providers, and it is worth noting that it produced two confident, specific, wrong accusations
   against the server rather than an error. */
const rows = (body) => (Array.isArray(body) ? body : (body?.content ?? []));

const liveList = await api('GET', '/visits', null, token);
const liveRaw = rows(liveList.body).find((v) => v.id === liveId);

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
const mock = await load('../src/services/providers/mock/visitProvider.js');
// The seed is fetched asynchronously and `rawDb()` throws outright if it is not there yet — in the
// browser `main.jsx` awaits this before rendering, and a script has to do the same.
const { rawDb, ensureMockDb } = await load('../src/lib/mockApi.js');
await ensureMockDb();
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

// ─── Reschedule round trip (D87) ──────────────────────────────────────────────────────────────
// Move the live visit to a new slot and prove the server accepts it, keeps the id, and resets the
// status to `scheduled`. The mock does the same in memory, so a caller written against one holds on
// the other.
if (liveId) {
  const newSlot = slotFromParts(furtherDateIso(), '3:00 PM');
  const moved = await api('PATCH', `/visits/${liveId}/slot`, { slot: newSlot }, token);
  if (moved.status !== 200) {
    failures.push(`rescheduleVisit: live returned HTTP ${moved.status}, expected 200`);
  }
  const afterMove = await api('GET', '/visits', null, token);
  const movedRaw = rows(afterMove.body).find((v) => v.id === liveId);
  if (!movedRaw) {
    failures.push('rescheduleVisit: the live visit vanished after a reschedule — the id was not kept');
  } else {
    if (movedRaw.status !== 'scheduled') failures.push(`rescheduleVisit: live status is "${movedRaw.status}" after a move, expected "scheduled"`);
    // Compared as instants, not as strings. The server echoes `2026-09-10T09:30:00Z` for the
    // `...:00.000Z` that was sent — the same moment, spelled without the milliseconds it does not
    // store. A string comparison called that a contract break; the calendar parses this value, so
    // the only thing that can actually break is the instant being wrong.
    if (Date.parse(movedRaw.slot) !== Date.parse(newSlot)) {
      failures.push(`rescheduleVisit: live slot is "${movedRaw.slot}", a different instant from the requested "${newSlot}"`);
    }
  }
}
const mockMoved = await mock.rescheduleVisit(mockCreated.id, whenFromSlot(slotFromParts(furtherDateIso(), '3:00 PM'), 'in-person'));
if (mockMoved?.status !== 'scheduled') {
  failures.push(`rescheduleVisit: the mock did not reset status to "scheduled" (got "${mockMoved?.status}")`);
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

/** A second, later date for the reschedule round trip — distinct from {@link futureDateIso}. */
function furtherDateIso() {
  const d = new Date();
  d.setDate(d.getDate() + 21);
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
    console.log('  PASS — mock and live visit providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
