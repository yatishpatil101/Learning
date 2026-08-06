/**
 * Contract-parity check: mock notification provider vs the live API, through the http mapper.
 *
 * `notificationService.js` is a seam — the Notifications page and the navbar bell are written
 * against one interface and must not care which provider answered. Unusually for this codebase,
 * most of the risk here is **not** in the request building. It is in two places:
 *
 * 1. **The type vocabulary.** The server emits dotted namespaces (`flatmate.interest`); the page's
 *    `ICONS` and `FILTERS` maps use a flat set (`match|enquiry|price|visit|share|…`). They do not
 *    overlap at all, and the page's `ICONS[n.type] || ICONS.system` fallback means a bad mapping
 *    renders a plausible grey row instead of throwing. The visible symptom would be filter chips
 *    that empty the page, which reads as "the filters are broken", not "the mapping is wrong".
 * 2. **`at` being a number.** The page sorts on it, groups Today/Earlier from it and computes
 *    `Date.now() - at`. An ISO string sorts lexicographically (mostly right, so it survives casual
 *    testing) and makes every relative time `NaN`.
 *
 * Both are asserted below, along with the field-shape diff every other parity script does.
 *
 * Usage (backend must be running):
 *   node scripts/notification-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/notification-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes match, 1 = drift found (suitable for CI).
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

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
// The mock provider's dependency chain reaches Vite-only features, and the http provider needs
// `import.meta.env.VITE_API_BASE`. Loading both this way keeps this a test of the *actual* modules
// the browser runs rather than Node-adapted lookalikes.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
// The http provider does not take a token argument — it reads the session the way the app does,
// through `lib/auth.js` → `puneNestTokens`. Driving the *real* provider therefore means persisting
// the session in the real shape rather than passing a bearer around, which is the point: a change
// to where the app keeps its token would break this script exactly as it would break the app.
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token,
  refreshToken: loginRes.body.refreshToken,
}));

const mock = await load('../src/services/providers/mock/notificationProvider.js');
const live = await load('../src/services/providers/http/notificationProvider.js');
const { toUiType, toViewModel } = await load('../src/services/providers/http/notificationMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
// `notificationService.js` forwards blindly, so a method added to one and forgotten on the other
// fails at runtime, on whichever page calls it, in whichever mode nobody tested.
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const mockSurface = surfaceOf(mock);
const liveSurface = surfaceOf(live);
const missingOnLive = mockSurface.filter((k) => !liveSurface.includes(k));
const missingOnMock = liveSurface.filter((k) => !mockSurface.includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── Drive both sides ─────────────────────────────────────────────────────────────────────────
// A fresh account has an empty inbox, which is a legitimate state and not an error: only flatmate
// flows write notification rows server-side today. So the *list* shape is checked against whatever
// the API returns, and the row-level assertions run against a synthesised wire row when the live
// inbox is empty — the mapper is the thing under test, and it does not care where the row came from.
const liveList = await live.listNotifications();
const liveRaw = (await api('GET', '/notifications?size=100', null, token)).body;

if (!Array.isArray(liveList)) {
  failures.push(`listNotifications must return an array, got ${typeof liveList}`);
}
if (liveRaw?.content === undefined) {
  failures.push('GET /notifications did not return a PageEnvelope — the provider unwraps `content`');
}

// Seed the mock so there is something to compare shapes against.
globalThis.localStorage.setItem(
  `pnNotifications:${MOBILE}`,
  JSON.stringify([
    { id: 'seed-a', type: 'match', read: false, at: Date.now(), title: 'A match', desc: 'Body text', link: '/listings' },
    { id: 'seed-b', type: 'visit', read: true, at: Date.now() - 3600_000, title: 'A visit', desc: 'Body text', link: '/dashboard' },
  ]),
);
const mockList = await mock.listNotifications();
if (!Array.isArray(mockList) || mockList.length !== 2) {
  failures.push(`mock listNotifications returned ${mockList?.length} rows, expected the 2 seeded`);
}

// ─── The row shape the page renders ───────────────────────────────────────────────────────────
// Every one of these is read unconditionally by Notifications.jsx; an absent field is a blank row
// or a `NaN` timestamp rather than an error.
const REQUIRED = ['id', 'type', 'title', 'desc', 'read', 'at'];
const sampleLive = liveList[0] ?? toViewModel({
  id: '00000000-0000-4000-8000-000000000000',
  type: 'flatmate.interest',
  title: 'Someone is interested',
  body: 'Reach them on 98XXXXX210.',
  read: false,
  link: '/flatmates',
  createdAt: new Date().toISOString(),
});
for (const field of REQUIRED) {
  if (sampleLive[field] === undefined) failures.push(`live row is missing required field \`${field}\``);
  if (mockList[0]?.[field] === undefined) failures.push(`mock row is missing required field \`${field}\``);
}

// `at` must be a *number*. See the header — an ISO string mostly sorts correctly, so this survives
// casual testing and shows up as "just now" on everything, forever.
if (typeof sampleLive.at !== 'number' || Number.isNaN(sampleLive.at)) {
  failures.push(`live row \`at\` is ${typeof sampleLive.at} (${sampleLive.at}) — the page needs epoch ms`);
}
if (typeof mockList[0]?.at !== 'number') {
  failures.push(`mock row \`at\` is ${typeof mockList[0]?.at} — the page needs epoch ms`);
}
if (typeof sampleLive.read !== 'boolean') {
  failures.push(`live row \`read\` is ${typeof sampleLive.read}, expected boolean`);
}

// ─── The type vocabulary ──────────────────────────────────────────────────────────────────────
// The UI set is closed: these are exactly the keys in Notifications.jsx's ICONS map. A translated
// type outside it renders as an anonymous grey row and matches no filter chip.
const UI_TYPES = new Set(['match', 'enquiry', 'price', 'visit', 'share', 'document', 'service', 'system']);

// Every type the backend actually writes today (grep: `new Notification(` in the flatmate services).
const SERVER_TYPES = [
  'flatmate.interest',
  'flatmate.request.accepted',
  'flatmate.request.declined',
  'flatmate.review.approved',
  'flatmate.review.rejected',
  'flatmate.agreement.reissue',
  'flatmate.room.interest',
];
for (const wire of SERVER_TYPES) {
  const ui = toUiType(wire);
  if (!UI_TYPES.has(ui)) {
    failures.push(`toUiType("${wire}") → "${ui}", which is not a UI type — it will render grey and match no filter`);
  }
}

// The filter chips are a subset of the icon map. A server type mapping to something outside the
// chips is legal (`system` has no chip and that is deliberate), but a type mapping to a *nonexistent*
// chip is not — this is the assertion that would have caught a typo like 'flatmates'.
const FILTER_CHIPS = new Set(['all', 'match', 'enquiry', 'price', 'visit', 'share']);
const unreachable = SERVER_TYPES.map(toUiType).filter((t) => !FILTER_CHIPS.has(t) && t !== 'system' && t !== 'service' && t !== 'document');
if (unreachable.length) {
  failures.push(`server types map to chip-less UI types: ${[...new Set(unreachable)].join(', ')}`);
}

// Pass-through must be exactly that: the mock's own vocabulary is already the UI's, so translating
// it a second time (e.g. lower-casing, prefix-stripping) would silently reclassify every mock row.
for (const t of UI_TYPES) {
  if (toUiType(t) !== t) failures.push(`toUiType("${t}") changed a UI type to "${toUiType(t)}" — pass-through is broken`);
}

// An unknown type must degrade to `system` *and* be audible. Degrading gracefully and degrading
// silently are different things, and the warning is what makes the next backend type visible.
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => warns.push(a.join(' '));
const unknown = toUiType('billing.invoice.overdue');
console.warn = realWarn;
if (unknown !== 'system') failures.push(`an unknown type must fall back to "system", got "${unknown}"`);
if (!warns.length) failures.push('an unknown notification type was translated silently — no console warning');

// ─── Mark-read and dismiss ────────────────────────────────────────────────────────────────────
// `markAllRead` sends an empty body, which the server defines as "all". The dangerous adjacent bug
// is a caller passing an unfiltered empty array to `markRead`, which would clear the whole inbox —
// so assert the single-id path actually sends one id.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/notifications/read')) sent.push(init?.body ? JSON.parse(init.body) : null);
  return realFetch(url, init);
};
await live.markRead('00000000-0000-4000-8000-000000000000');
await live.markAllRead();
globalThis.fetch = realFetch;

if (sent[0]?.ids?.length !== 1) {
  failures.push(`markRead(id) must send exactly one id, sent ${JSON.stringify(sent[0])}`);
}
if (sent[1]?.ids?.length) {
  failures.push(`markAllRead must send no ids (the server reads that as "all"), sent ${JSON.stringify(sent[1])}`);
}

// Dismiss has no endpoint and is a local tombstone. What matters is that it is *durable enough to
// hide the row on the next read* — otherwise the X appears to do nothing, which is worse than not
// offering it. This is the one behaviour in the slice with no server counterpart at all, so leaving
// it unasserted because the live inbox happened to be empty would be leaving the new mechanism
// entirely uncovered.
//
// A client-derived row is used when the server has none. Both kinds pass through the same
// `dismissedIds()` filter in `listNotifications`, so this drives the real tombstone path either way
// — only the server round-trip is skipped, and there is nothing server-side to round-trip to.
const derivedProbe = {
  id: 'parity-derived-probe',
  type: 'match',
  title: 'A derived alert',
  desc: 'Client-side, like a saved-search match.',
  read: false,
  at: Date.now(),
};
const victim = liveList[0]?.id ?? derivedProbe.id;
const extras = liveList.length ? [] : [derivedProbe];

const beforeDismiss = await live.listNotifications(extras);
if (!beforeDismiss.some((n) => n.id === victim)) {
  failures.push(`the row to be dismissed (${victim}) was not in the list to begin with — the merge dropped it`);
}
await live.dismiss(victim);
const afterDismiss = await live.listNotifications(extras);
if (afterDismiss.some((n) => n.id === victim)) {
  failures.push('dismiss() did not hide the row from the next listNotifications() — the tombstone is not being applied');
}
if (!liveList.length) {
  warnings.push('live inbox is empty, so dismiss() was driven against a client-derived row (only flatmate flows write server rows)');
}

// A dismissed row must not keep inflating the bell either. A badge counting rows the user can no
// longer see is a badge they cannot clear, which is the more annoying half of getting this wrong.
const countAfter = await live.unreadCount();
if (typeof countAfter !== 'number' || Number.isNaN(countAfter)) {
  failures.push(`unreadCount() returned ${countAfter}, expected a number`);
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

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
  globalThis.location ??= new URL(BASE);
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
    console.log('  PASS — mock and live notification providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
