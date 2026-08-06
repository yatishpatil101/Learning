/**
 * Contract-parity check: mock contact provider vs the live API.
 *
 * `contactService.js` is a seam — the property page, the owner dashboard and the chat thread are
 * written against one interface and must not care which provider is wired in. That only holds if
 * both providers return the *same shape*, and the contact slice is where a shape gap is most
 * costly: every field here decides whether a phone number is shown. A missing `ownerHidesNumber`
 * reads as `undefined` → falsy → "the owner is fine with calls", which silently overrides a
 * privacy preference. That is the class of bug this script exists to catch.
 *
 * It drives the real `providers/mock/contactProvider.js` — not a re-implementation — so drift in
 * the mock is caught too. Browser storage is stubbed in-memory below.
 *
 * Usage (backend must be running):
 *   node scripts/contact-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/contact-parity.mjs --base http://localhost:8080/api   (prompts for the OTP)
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

// Any approved listing will do — the gate shape does not depend on which one, and picking the
// first search hit keeps the script working against a re-seeded database.
const search = await api('GET', '/properties?size=1', null, token);
const liveProperty = search.body?.content?.[0];
if (!liveProperty) {
  console.error('\n  No listings returned by GET /properties — seed the database first.\n');
  process.exit(1);
}

const liveStatus = (await api('GET', `/contacts/status?propertyId=${encodeURIComponent(liveProperty.id)}`, null, token)).body;
const liveInbox = (await api('GET', '/me/contact-requests', null, token)).body;
const livePending = (await api('GET', '/me/contact-requests/pending-count', null, token)).body;

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
// Signed in as a mock user so `myMobile()` resolves and the inbox is addressable.
globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));

const mock = await import('../src/services/providers/mock/contactProvider.js');
const { rawDb } = await import('../src/lib/mockApi.js');
const mockProperty = rawDb().listings.find((p) => p.ownerMobile);
if (!mockProperty) {
  console.error('\n  The mock database has no listing with an ownerMobile.\n');
  process.exit(1);
}

const mockStatus = await mock.contactStatus(mockProperty.id);
const mockInbox = await mock.myContactRequests();
const mockPending = await mock.pendingContactCount();

// ─── Diff ─────────────────────────────────────────────────────────────────────────────────────
// Values legitimately differ (different listings, different accounts); only the shape and the
// *type* of each field must agree. A boolean that arrives as `undefined` is the failure mode that
// matters, because every consumer reads these as plain truthiness.
const GATE_FIELDS = {
  status: 'string',
  verifiedContactOnly: 'boolean',
  verificationRequired: 'boolean',
  ownerHidesNumber: 'boolean',
};

for (const [field, type] of Object.entries(GATE_FIELDS)) {
  checkType('contactStatus', field, type, mockStatus?.[field], liveStatus?.[field]);
}

const VALID_STATUSES = ['owner', 'approved', 'pending', 'declined', 'none'];
for (const [label, value] of [['mock', mockStatus?.status], ['live', liveStatus?.status]]) {
  if (!VALID_STATUSES.includes(value)) {
    failures.push(`contactStatus.status: ${label} returned "${value}", not one of ${VALID_STATUSES.join('|')}`);
  }
}

// The paged envelope. `total` must count the whole result set, not the page — the difference the
// owner's "waiting on you" badge is built on.
for (const [field, type] of Object.entries({ items: 'object', total: 'number', page: 'number', size: 'number' })) {
  checkType('myContactRequests', field, type, mockInbox?.[field], liveInbox && unwrapInbox(liveInbox)[field]);
}

if (typeof mockPending !== 'number') failures.push(`pendingContactCount: mock returned ${typeof mockPending}, expected number`);
if (typeof livePending?.pending !== 'number') failures.push(`pendingContactCount: live returned ${JSON.stringify(livePending)}, expected { pending: number }`);

// Row shape, when either side has one to compare. Skipped rather than failed when both inboxes are
// empty: an empty inbox is a legitimate state, and inventing a request here would leave a row in
// somebody's real database.
const mockRow = mockInbox?.items?.[0];
const liveRow = unwrapInbox(liveInbox).items?.[0];
if (mockRow && liveRow) {
  for (const field of ['id', 'propertyId', 'status', 'createdAt']) {
    checkType('contactRequest', field, 'string', mockRow[field], liveRow[field]);
  }
  for (const field of ['name', 'mobile', 'role']) {
    checkType('contactRequest.requester', field, 'string', mockRow.requester?.[field], liveRow.requester?.[field]);
  }
  // The reveal rule itself: an unapproved row must not carry a raw contact on either side.
  for (const [label, row] of [['mock', mockRow], ['live', liveRow]]) {
    if (row.status !== 'approved' && row.contact) {
      failures.push(`contactRequest.contact: ${label} exposed a contact on a "${row.status}" row — the gate leaks`);
    }
  }
} else {
  warnings.push('contactRequest row shape not compared — one or both inboxes were empty');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** Spring's page envelope → the seam's envelope, mirroring providers/http/contactProvider.js. */
function unwrapInbox(res) {
  return { items: res?.content ?? [], total: res?.totalElements, page: res?.number, size: res?.size };
}

function checkType(scope, field, type, mockValue, liveValue) {
  const mockType = mockValue === null ? 'null' : Array.isArray(mockValue) ? 'object' : typeof mockValue;
  const liveType = liveValue === null ? 'null' : Array.isArray(liveValue) ? 'object' : typeof liveValue;
  if (mockType !== type) failures.push(`${scope}.${field}: mock is ${mockType}, expected ${type}`);
  if (liveType !== type) failures.push(`${scope}.${field}: live is ${liveType}, expected ${type}`);
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
    console.log('  PASS — mock and live contact providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
