/**
 * Contract-parity check: mock verification provider vs the live API, through the http mapper.
 *
 * `verificationService.js` is a seam — `VerificationContext.jsx` fetches the badge once and the whole
 * app reads it, never caring which provider answered. The badge is a trust signal, never a gate
 * (ADR-019: "a badge, never a wall"), so this harness pins the two places the providers must agree
 * and the one place their vocabularies differ:
 *
 * 1. **Both answer the same view-model keys.** The context spreads the result; a key the live
 *    provider omits would read as `undefined` and quietly change how a chip renders. `aadhaarMobile`
 *    is the sharp edge — it is on the mock's model but never on the wire (DigiLocker returns no
 *    mobile), so the mapper carries it as `''` rather than dropping it.
 * 2. **A start is a pending handle, not a badge.** `POST /me/verification/aadhaar` answers 202 with a
 *    DigiLocker consent url; the badge is granted only when the signed webhook lands. So a live start
 *    reads back `pending:true, verified:false` — treating "the POST returned" as "verified" would
 *    light a trust badge for an abandoned consent screen. (The mock, having no webhook, grants at
 *    once — that asymmetry is the point of the seam, not a break.)
 * 3. **The read is honest for someone who never tried.** `GET` answers 200 with
 *    `{ badge:false, status:"none", … }` rather than 404, so a fresh account reads `status:'none'`,
 *    `verified:false`. After a start, the same read reports `status:'pending'` — the write is durable
 *    server-side, not just a client redirect.
 *
 * Usage (backend must be running):
 *   node scripts/verification-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/verification-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);

// ─── Sign in (a fresh mobile → a user who has never touched verification) ─────────────────────
await api('POST', '/auth/login', { mobile: MOBILE });
const otp = await readOtp(MOBILE);
const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
if (loginRes.status !== 200) {
  console.error(`\n  Live login failed (HTTP ${loginRes.status}): ${JSON.stringify(loginRes.body)}\n`);
  process.exit(1);
}
const token = loginRes.body.accessToken;
const meId = loginRes.body.user?.id;

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

const mock = await load('../src/services/providers/mock/verificationProvider.js');
// The mock reads a seed that is fetched asynchronously, and every read throws until it lands — in
// the browser `main.jsx` awaits this before rendering, and a script has to do the same.
await (await load('../src/lib/mockApi.js')).ensureMockDb();
const live = await load('../src/services/providers/http/verificationProvider.js');
const { NONE_VERIFICATION, toVerificationViewModel, toStartHandle } = await load('../src/services/providers/http/verificationMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);
for (const op of ['getAadhaarStatus', 'startAadhaar']) {
  if (typeof live[op] !== 'function') failures.push(`http provider must export \`${op}\``);
  if (typeof mock[op] !== 'function') failures.push(`mock provider must export \`${op}\``);
}

// ─── Null-safety and field mapping, driven through the mapper directly ────────────────────────
const NONE_KEYS = Object.keys(NONE_VERIFICATION).sort();
const none = toVerificationViewModel(null);
if (none.verified !== false || none.status !== 'none') {
  failures.push('toVerificationViewModel(null) must read as the none-tier (verified:false, status:"none"), not a half-built object');
}
if (none.aadhaarMobile !== '') failures.push('toVerificationViewModel(null) must carry aadhaarMobile:"" so the shape matches the mock provider');
if (Object.keys(none).sort().join(',') !== NONE_KEYS.join(',')) {
  failures.push(`toVerificationViewModel(null) keys drifted from NONE_VERIFICATION: got ${Object.keys(none).sort().join(',')}`);
}

// A full wire badge maps every field; verifiedAt becomes an epoch number; aadhaarMobile stays blank.
const vm = toVerificationViewModel({
  badge: true,
  status: 'verified',
  source: 'digilocker',
  maskedAadhaar: 'XXXX XXXX 1234',
  mobileMatch: true,
  verifiedAt: '2026-01-02T03:04:05Z',
});
if (vm.verified !== true) failures.push('a wire badge:true must map to verified:true');
if (vm.status !== 'verified') failures.push('the finer `status` must pass through unchanged');
if (vm.source !== 'digilocker') failures.push('`source` must pass through — it is the provenance line the badge shows');
if (vm.maskedAadhaar !== 'XXXX XXXX 1234') failures.push('`maskedAadhaar` must pass through for display');
if (vm.mobileMatch !== true) failures.push('`mobileMatch` (the soft ADR-009a signal) must pass through');
if (typeof vm.verifiedAt !== 'number') failures.push('`verifiedAt` must be parsed to an epoch number — the UI formats it as a date');
if (vm.aadhaarMobile !== '') failures.push('`aadhaarMobile` is never on the wire and must read back as "" (see mapper header)');

// A start handle is pending, not a badge, and never fabricates a perk.
const handle = toStartHandle({ ref: 'ref-123', verificationUrl: 'https://digilocker.example/consent/abc', expiresAt: '2026-01-02T03:04:05Z' });
if (handle.pending !== true || handle.verified !== false) {
  failures.push('toStartHandle must read as pending:true, verified:false — a 202 is a consent url, not a granted badge');
}
if (handle.ref !== 'ref-123') failures.push('toStartHandle must carry the `ref` — the webhook correlates on it');
if (!handle.verificationUrl) failures.push('toStartHandle must carry the DigiLocker `verificationUrl` the modal redirects to');
if (typeof handle.expiresAt !== 'number') failures.push('toStartHandle `expiresAt` must be a parsed epoch number');
if (handle.perk !== null) failures.push('toStartHandle `perk` must be null — the growth perk has no server counterpart and stays mock-only');

// ─── Both providers must answer the same keys ─────────────────────────────────────────────────
// The mock's store is empty (fresh stub), so it too answers the none-tier — and must use the same
// keys the live provider does, or the context would read a different shape depending on the mode.
const mockNone = await mock.getAadhaarStatus();
if (Object.keys(mockNone).sort().join(',') !== NONE_KEYS.join(',')) {
  failures.push(`mock getAadhaarStatus keys drifted from the view model: got ${Object.keys(mockNone).sort().join(',')}`);
}
if (mockNone.verified !== false || mockNone.status !== 'none') {
  failures.push('mock getAadhaarStatus must answer the none-tier when the store holds no record');
}

// The mock's *verified* tier is not reachable on the live side (the webhook cannot fire in dev), so
// only the mock can pin it — exercise it explicitly rather than leaving it to drift. A mock start
// grants at once, so the next read is the verified view model, which must answer the same keys.
await mock.startAadhaar({ aadhaarMobile: '9876500000' });
const mockVerified = await mock.getAadhaarStatus();
if (Object.keys(mockVerified).sort().join(',') !== NONE_KEYS.join(',')) {
  failures.push(`mock verified getAadhaarStatus keys drifted from the view model: got ${Object.keys(mockVerified).sort().join(',')}`);
}
if (mockVerified.verified !== true || mockVerified.status !== 'verified') {
  failures.push('mock getAadhaarStatus must answer the verified tier after a mock start grants the badge');
}

// ─── Live read: a fresh account has never tried, so the badge is honestly absent (200, not 404) ──
const before = await live.getAadhaarStatus();
if (Object.keys(before).sort().join(',') !== NONE_KEYS.join(',')) {
  failures.push(`live getAadhaarStatus keys drifted from the view model: got ${Object.keys(before).sort().join(',')}`);
}
if (before.verified !== false) failures.push('a fresh account must not read as verified — nothing has granted the badge');
if (before.status !== 'none') failures.push(`a fresh account must read status:'none', got ${JSON.stringify(before.status)}`);

// ─── Live start: a 202 pending handle, and the write is durable (the next read is `pending`) ────
const started = await live.startAadhaar();
if (started.verified !== false) failures.push('startAadhaar must not report the badge as granted — the webhook has not landed');
if (started.pending !== true) failures.push('startAadhaar must report pending:true');
if (!started.ref) failures.push('startAadhaar must carry the `ref` the webhook correlates on');
if (!started.verificationUrl) failures.push('startAadhaar must carry the DigiLocker `verificationUrl`');
if (started.perk !== null) failures.push('startAadhaar (live) `perk` must be null');

const after = await live.getAadhaarStatus();
if (after.status !== 'pending') {
  failures.push(`after a start, the live read must report status:'pending' — the handle is persisted server-side, got ${JSON.stringify(after.status)}`);
}
if (after.verified !== false) failures.push('a pending start must still read verified:false — pending is not granted');

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
  console.log('\n  PASS — mock and live verification providers agree on every field the UI relies on.\n');
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
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
  globalThis.dispatchEvent ??= () => {};
}
