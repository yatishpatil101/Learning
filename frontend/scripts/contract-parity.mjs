/**
 * Contract-parity check: mock auth provider vs the live API.
 *
 * `authService.js` is a seam — `AuthContext` and every screen behind it are written against one
 * interface and must not care which provider is wired in. That only holds if both providers return
 * the *same shape*. This script proves it rather than assuming it: it drives the same sequence of
 * calls through the real mock provider and the live backend, then diffs the resulting objects.
 *
 * It runs the actual `providers/mock/authProvider.js` (not a re-implementation), so drift in the
 * mock is caught too. The browser storage the mock depends on is stubbed in-memory below.
 *
 * Usage (backend must be running):
 *   node scripts/contract-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/contract-parity.mjs --base http://localhost:8080/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes match, 1 = drift found (suitable for CI).
 */
import { assertLoopbackBase } from './lib-assert-local-base.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
// A throwaway mobile so the run is idempotent and never mutates a seeded account.
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;

/** Refuse a `--base` that is not loopback — the shared test lives in `lib-assert-local-base.mjs`. */
assertLoopbackBase(
  BASE,
  args.has('i-know-what-im-doing'),
  'This harness signs in with a real OTP and writes contract rows, so it may only run against a'
  + '\n  backend on this machine.',
);

installStorageStubs();

// Plain `await import()` cannot reach the mock provider: it pulls in `mockApi/core`, which imports
// `db.json` (Node >= 22 demands an import attribute) and `persist.js` (which reads
// `import.meta.env.DEV`, undefined outside a bundler — the `Cannot read properties of undefined
// (reading 'DEV')` this used to die on). Vite's SSR loader resolves both, and it is what every
// other harness here already uses.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

const mock = await load('../src/services/providers/mock/authProvider.js');
// The seed is fetched asynchronously and every mock read throws until it lands.
await (await load('../src/lib/mockApi.js')).ensureMockDb();

const failures = [];

// ─── Drive the mock ───────────────────────────────────────────────────────────────────────────
await mock.sendOtp({ mobile: MOBILE });
const mockUser = await mock.login({ mobile: MOBILE, name: 'Parity Probe', remember: true });
const mockMe = await mock.getMe();
const mockPatched = await mock.updateMe({ name: 'Parity Renamed' });
await mock.logout();
const mockAfterLogout = await mock.getMe();

// ─── Drive the live API ───────────────────────────────────────────────────────────────────────
const sendRes = await api('POST', '/auth/login', { mobile: MOBILE });
if (sendRes.body?.otpSent !== true) failures.push(`sendOtp: live returned ${JSON.stringify(sendRes.body)}, expected { otpSent: true }`);

const otp = await readOtp(MOBILE);
const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
if (loginRes.status !== 200) {
  console.error(`\n  Live login failed (HTTP ${loginRes.status}): ${JSON.stringify(loginRes.body)}\n`);
  process.exit(1);
}
const live = loginRes.body;
const token = live.accessToken;
const liveUser = live.user;
const liveMe = (await api('GET', '/auth/me', null, token)).body;
const livePatched = (await api('PATCH', '/auth/me', { name: 'Parity Renamed' }, token)).body;

// ─── Diff ─────────────────────────────────────────────────────────────────────────────────────
// The *values* legitimately differ (real UUIDs, real timestamps); only the shape must agree, and
// only for the fields the UI actually consumes. Extra server fields are fine. The dangerous
// direction is a field the mock invents that the server never sends, because screens read it and
// get `undefined` the moment the switch flips.
//
// REQUIRED fields are consumed without a fallback — a gap here is a break. OPTIONAL fields are read
// everywhere as `user?.x || 'default'`, so a gap degrades gracefully and is reported as a warning.
const REQUIRED = ['mobile', 'role'];
const OPTIONAL = ['id', 'name', 'email', 'status', 'verified', 'avatar', 'city'];

const warnings = [];

compare('login().user', mockUser, liveUser);
compare('getMe()', mockMe, liveMe);
compare('updateMe()', mockPatched, livePatched);

if (mockAfterLogout !== null) failures.push('logout(): mock getMe() should return null afterwards');

// Token contract — the mock has no tokens, so this only asserts the live side is complete.
for (const field of ['accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'user']) {
  if (live[field] === undefined) failures.push(`AuthResponse: live is missing "${field}"`);
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function compare(label, mockObj, liveObj) {
  if (!mockObj || !liveObj) {
    failures.push(`${label}: ${!mockObj ? 'mock' : 'live'} returned nothing`);
    return;
  }
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    if (mockObj[key] === undefined || liveObj[key] !== undefined) continue;
    const note = `${label}.${key}: in mock (${JSON.stringify(mockObj[key])}), absent live`;
    if (REQUIRED.includes(key)) failures.push(`${note} — consumed without a fallback, this will break`);
    else warnings.push(`${note} — consumed as \`|| fallback\`, degrades gracefully`);
  }
  const mockOnly = Object.keys(mockObj).filter((k) => liveObj[k] === undefined);
  const liveOnly = Object.keys(liveObj).filter((k) => mockObj[k] === undefined);
  console.log(`  ${label}`);
  console.log(`    mock-only fields: ${mockOnly.length ? mockOnly.join(', ') : '(none)'}`);
  console.log(`    live-only fields: ${liveOnly.length ? liveOnly.join(', ') : '(none)'}`);
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

/**
 * The mock OtpSender only logs the code, so it cannot be read over HTTP. Two ways to supply it:
 * `--otp-log <path>` scrapes the backend's console log (the automatable path), otherwise the script
 * prompts and the developer pastes it from the backend console. Deliberately no dev-only "reveal
 * OTP" endpoint — that would be a real auth bypass in exchange for convenience in one script.
 */
async function readOtp(mobile) {
  const logPath = args.get('otp-log');
  if (logPath) {
    const { readFileSync } = await import('node:fs');
    // Poll briefly: the send returns before the log line is necessarily flushed to disk.
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

/** Minimal in-memory Web Storage so the mock provider's lib/auth.js runs outside a browser. */
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

function report() {
  console.log('');
  if (warnings.length) {
    console.log(`  ${warnings.length} tolerated difference(s):`);
    warnings.forEach((w) => console.log(`    ~ ${w}`));
    console.log('');
  }
  if (!failures.length) {
    console.log('  PASS — mock and live auth providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
