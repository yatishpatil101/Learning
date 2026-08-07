/**
 * Contract-parity check: mock report provider vs the live API, through the http mapper.
 *
 * `reportService.js` is a seam — the platform-wide report modal and the ops queue are written
 * against one interface and must not care which provider answered. This domain is the first where
 * **the two ends have different audiences**, and where the mock is permissive in ways that hide
 * real server rules:
 *
 * 1. **`kind` is not `targetType`, and the reason is validated against it.** `listing → property`,
 *    `share → post`. `Flatmates.jsx` sent `kind='user'` with `SHARE_REPORT_REASONS`, so every
 *    flatmate report was a 400 waiting to happen — the mock stored it and it landed in the queue
 *    under the wrong tab. The mapping table is asserted here so it cannot silently regress.
 * 2. **A duplicate is a 409, not a second row.** The mock has no such rule. The provider must return
 *    `'duplicate'` rather than throw, so the modal can say something true.
 * 3. **Terminal is terminal.** `actioned`/`dismissed` cannot move. `canTriage` is what stops the
 *    queue offering a Reopen button that 409s.
 * 4. **`resolved` does not exist server-side.** It is the queue's word for "no action needed" and
 *    must be sent as `dismissed` — but never *displayed* as `resolved`, or the queue shows a state
 *    the server did not record.
 * 5. **`GET /reports` is staff/admin.** A consumer session must get 403, not an empty queue: an
 *    empty moderation queue looks like "nothing to do".
 *
 * Usage (backend must be running):
 *   node scripts/report-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/report-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98766${String(Date.now()).slice(-5)}`;
/** A seeded staff account — the only kind that may read the queue. */
const STAFF_MOBILE = args.get('staff') || '9711827190';

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);

// ─── Sign in as an ordinary reporter ──────────────────────────────────────────────────────────
const consumer = await signIn(MOBILE);

// A real property to complain about. `targetId` is free text on the schema, but using a real id
// keeps the fixture honest and lets a moderator click through.
const props = await api('GET', '/properties?size=1');
const TARGET_ID = props.body?.content?.[0]?.id;
if (!TARGET_ID) {
  console.error('\n  No seeded property found — cannot file a report against anything.\n');
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

useSession(consumer);

const mock = await load('../src/services/providers/mock/reportProvider.js');
const live = await load('../src/services/providers/http/reportProvider.js');
const { toReportCreate, toReportTriage, toTargetType, toViewModel, canTriage } =
  await load('../src/services/providers/http/reportMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The kind → targetType table ──────────────────────────────────────────────────────────────
// Driven directly, because the round trip below only exercises one kind. This is the assertion the
// flatmates bug needed: `share` must not resolve to `user`.
for (const [kind, expected] of [['listing', 'property'], ['user', 'user'], ['share', 'post'], ['review', 'review']]) {
  const got = toTargetType(kind);
  if (got !== expected) {
    failures.push(`kind "${kind}" mapped to targetType "${got}", expected "${expected}" — the server validates the reason against the target type, so a wrong type is a 400, not a mislabel`);
  }
}

// ─── The create body must carry only what the schema declares ─────────────────────────────────
const body = toReportCreate({
  kind: 'listing',
  targetId: TARGET_ID,
  reason: 'fake',
  details: 'Parity probe.',
  // Simulating the modal, which holds all of these. None is on `ReportCreate`.
  targetTitle: 'A title',
  targetOwner: 'An owner',
  reportedBy: 'Somebody Else',
  reporterMobile: '9999999999',
  url: 'https://example.test/x',
});
for (const forbidden of ['reportedBy', 'reporterMobile', 'reporterId', 'targetTitle', 'targetOwner', 'url', 'kind', 'status']) {
  if (forbidden in body) {
    failures.push(`toReportCreate leaked \`${forbidden}\` into the create body — the reporter comes from the principal, and a body field naming them turns an abuse queue into an abuse vector`);
  }
}
if (body.targetType !== 'property') failures.push('toReportCreate must translate kind → targetType');

// ─── The triage body ──────────────────────────────────────────────────────────────────────────
const triage = toReportTriage({ status: 'resolved', note: 'ok', actionTaken: 'Reviewed' });
if (triage.status !== 'dismissed') {
  failures.push(`a "resolved" triage was sent as ${JSON.stringify(triage.status)} — the server has no such status, and it means what it calls "dismissed"`);
}
if ('actionTaken' in triage) {
  failures.push('toReportTriage leaked `actionTaken` — the server keeps the moderator\'s words in the audit log, not on the row');
}

// ─── Round trip: file one ─────────────────────────────────────────────────────────────────────
const created = await live.createReport({ kind: 'listing', targetId: TARGET_ID, reason: 'fake', details: 'Parity probe.' });
if (created === 'duplicate') {
  warnings.push('the probe user already had a live report on this target — the create path was not exercised');
} else if (!created?.id) {
  failures.push('createReport returned no id');
} else {
  assertReportShape(created, 'the created report');
  if (created.status !== 'open') failures.push(`a new report opened as ${JSON.stringify(created.status)}, expected "open"`);
  if (created.kind !== 'listing') failures.push(`the created report came back as kind ${JSON.stringify(created.kind)} — targetType must map back for the queue's tabs`);
  if (!canTriage(created)) failures.push('a freshly filed report must be triageable');

  // ── the duplicate rule ──────────────────────────────────────────────────────────────────────
  const again = await live.createReport({ kind: 'listing', targetId: TARGET_ID, reason: 'fake', details: 'Parity probe, again.' });
  if (again !== 'duplicate') {
    failures.push('a second live report of the same target by the same person was not reported as `duplicate` — the modal would thank the user for a report nobody received');
  }
}

// ─── The queue is staff-only ──────────────────────────────────────────────────────────────────
// Asserted through the raw API rather than the provider, because the provider would throw and the
// distinction that matters is 403-not-200: an empty queue reads as "nothing to moderate".
const asConsumer = await api('GET', '/reports', null, consumer.token);
if (asConsumer.status !== 403) {
  failures.push(`GET /reports answered ${asConsumer.status} to a consumer, expected 403 — an accessible-but-empty moderation queue looks like "nothing to do"`);
}

// ─── The queue, as staff ──────────────────────────────────────────────────────────────────────
const staff = await signIn(STAFF_MOBILE);
useSession(staff);
const queue = await live.listReports();
for (const k of ['items', 'total', 'page', 'size']) {
  if (!(k in queue)) failures.push(`http listReports is missing \`${k}\``);
}
if (!Array.isArray(queue.items)) failures.push('`items` must be an array');
else if (queue.items.length) {
  assertReportShape(queue.items[0], 'a queue row');
}

// ─── Both providers must answer the same envelope ─────────────────────────────────────────────
const mockQueue = await mock.listReports();
for (const k of ['items', 'total', 'page', 'size']) {
  if (!(k in mockQueue)) failures.push(`mock listReports is missing \`${k}\``);
}

// ─── Terminal is terminal ─────────────────────────────────────────────────────────────────────
for (const [status, expected] of [['open', true], ['reviewing', true], ['actioned', false], ['dismissed', false]]) {
  if (canTriage({ status }) !== expected) {
    failures.push(`canTriage({status:'${status}'}) should be ${expected} — a decided report cannot be reopened, and offering the button means a 409 on click`);
  }
}

// ─── Null-safety of the mapper ────────────────────────────────────────────────────────────────
if (toViewModel(null) !== null) failures.push('toViewModel(null) must be null, not a half-built object');
const defaults = toViewModel({ id: 'r1', targetType: 'property', reason: 'fake' });
if (typeof defaults.at !== 'number') failures.push('toViewModel must always produce a numeric `at` — the queue sorts and formats it');
if (defaults.reasonLabel !== 'Fake photos or misleading info') {
  failures.push(`toViewModel must resolve reasonLabel locally, got ${JSON.stringify(defaults.reasonLabel)} — it is presentation text the client owns and the wire does not carry`);
}
if (defaults.targetTitle !== '') {
  failures.push('toViewModel must not invent a `targetTitle` — a resolved title would be a stale one, which is worse than the bare id');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function assertReportShape(r, what) {
  for (const f of ['id', 'kind', 'targetId', 'reason', 'reasonLabel', 'status']) {
    if (typeof r[f] !== 'string') failures.push(`${what} is missing \`${f}\` — the queue renders it`);
  }
  if (typeof r.at !== 'number') failures.push(`${what} must carry a numeric \`at\``);
}

async function signIn(mobile) {
  await api('POST', '/auth/login', { mobile });
  const otp = await readOtp(mobile);
  const res = await api('POST', '/auth/login', { mobile, otp });
  if (res.status !== 200) {
    console.error(`\n  Live login failed for ${mobile} (HTTP ${res.status}): ${JSON.stringify(res.body)}\n`);
    process.exit(1);
  }
  return { token: res.body.accessToken, refresh: res.body.refreshToken, id: res.body.user?.id, mobile };
}

/**
 * Make `session` the one the providers see.
 *
 * The http provider reads the session the way the app does (`lib/auth.js` → `puneNestTokens`)
 * rather than taking a token argument, so switching identity means rewriting storage. That is also
 * what lets this harness drive the *real* provider for both audiences.
 */
function useSession(session) {
  globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ id: session.id, name: 'Parity Probe', mobile: session.mobile, role: 'buyer' }));
  globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({ accessToken: session.token, refreshToken: session.refresh }));
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
  console.log('\n  PASS — mock and live report providers agree on every field the UI relies on.\n');
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
  // `lib/mockApi/core.js` subscribes at module scope and the mock provider reaches it through the
  // store. Node has no DOM event target, so these are the minimum that lets the *real* provider
  // load unmodified — which is the whole point of driving it rather than a reimplementation.
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
  globalThis.dispatchEvent ??= () => {};
}
