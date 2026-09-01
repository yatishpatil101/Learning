/**
 * Contract-parity check: mock support provider vs the live API, through the http mapper.
 *
 * `supportService.js` is a seam — `Support.jsx` is written against one interface and must not care
 * which provider answered. What makes this domain worth a harness is that **the mock is the richer
 * store**, so every gap is a field the page reads and the wire does not carry:
 *
 * 1. **`priority` does not exist on the wire** — not on `SupportTicket`, not on
 *    `SupportTicketCreate`. An unknown property is *ignored*, not rejected, so a create that sends
 *    one succeeds and the priority silently never exists. The mapper must not send it, and must
 *    report it as empty rather than defaulting to `'normal'` — a fabricated default renders a
 *    priority chip nobody set.
 * 2. **`images` do not exist on the wire.** `MessageCreate` is `{ body }`. Every consumer maps over
 *    `messages[].images` without a guard, so it must be `[]` and never `undefined`.
 * 3. **`at` must be a number.** The thread sorts on it and `fmtTime` does date arithmetic. An ISO
 *    string sorts almost right, which is why it survives casual testing.
 * 4. **`by` must be `customer` for the reader's own message.** `authorRole` is
 *    `buyer|owner|staff|admin`; mapping `owner` to the staff side renders the reader's own words as
 *    if support had sent them.
 * 5. **`updatedAt` is not on the wire** and the list sorts by it. Derived from the last message.
 *
 * Usage (backend must be running):
 *   node scripts/support-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/support-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
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
  'This harness signs in with a real OTP and files support tickets, so it may only run against a'
  + '\n  backend on this machine.',
);

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

const mock = await load('../src/services/providers/mock/supportProvider.js');
const live = await load('../src/services/providers/http/supportProvider.js');
const { toTicketCreate, toViewModel, toMessage } = await load('../src/services/providers/http/supportMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The create body must carry only what the schema declares ─────────────────────────────────
const body = toTicketCreate({
  subject: 'Parity probe ticket',
  category: 'account',
  message: 'Raised by scripts/support-parity.mjs.',
  // Simulating the form, which holds both. Neither has a home on `SupportTicketCreate`.
  priority: 'urgent',
  images: [{ data: 'data:image/png;base64,AAAA' }],
});
for (const forbidden of ['priority', 'images', 'mobile', 'name', 'email', 'status', 'userId']) {
  if (forbidden in body) {
    failures.push(`toTicketCreate leaked \`${forbidden}\` into the create body — the schema does not declare it, and an unknown property is ignored rather than rejected, so this would look like it worked`);
  }
}
for (const required of ['subject', 'category', 'body']) {
  if (!(required in body)) failures.push(`toTicketCreate is missing \`${required}\``);
}

// ─── Round trip: raise one, reply, read it back ───────────────────────────────────────────────
const created = await live.createTicket({
  subject: 'Parity probe ticket',
  category: 'account',
  message: 'Raised by scripts/support-parity.mjs.',
  priority: 'urgent',
});
if (!created?.id) {
  failures.push('createTicket returned no id');
} else {
  assertTicketShape(created, 'the created ticket');
  // The server opens every ticket `open`; `new` is a mock-only status.
  if (created.status === 'new') {
    failures.push('a live ticket came back with status `new` — the server opens every ticket `open`');
  }
  if (created.priority) {
    failures.push(`the live provider reported priority=${JSON.stringify(created.priority)} — it is not on the wire, and a fabricated default renders a chip nobody set`);
  }

  const replied = await live.replyToTicket(created.id, 'Parity probe reply.');
  if (!replied?.id) failures.push('replyToTicket returned no message');
  if (replied && replied.by !== 'customer') {
    failures.push(`the reader's own reply came back as by=${JSON.stringify(replied.by)} — mapping it to the staff side renders their own words as if support had sent them`);
  }
  if (replied && typeof replied.at !== 'number') {
    failures.push(`message \`at\` must be a number, got ${typeof replied.at} — the thread sorts on it and fmtTime does date arithmetic`);
  }
  if (replied && !Array.isArray(replied.images)) {
    failures.push('message `images` must be an array — the thread maps over it without a guard');
  }

  // `markTicketRead` is idempotent and must not throw for the ticket's own owner.
  await live.markTicketRead(created.id);

  const full = await live.getTicket(created.id);
  if (!full) {
    failures.push('getTicket did not return the ticket we just created');
  } else {
    assertTicketShape(full, 'the fetched ticket');
    if (full.messages.length < 2) {
      failures.push(`the fetched thread has ${full.messages.length} message(s) — the opening body and the reply should both be there`);
    }
    if (full.updatedAt < full.createdAt) {
      failures.push('`updatedAt` is older than `createdAt` — it is derived from the last message and must never go backwards');
    }
  }
}

// ─── The list ─────────────────────────────────────────────────────────────────────────────────
const list = await live.listTickets();
if (!Array.isArray(list)) {
  failures.push('listTickets must resolve to an array — the contract serves a bare list, not a PageResponse');
} else {
  if (created?.id && !list.some((t) => t.id === created.id)) {
    failures.push('a ticket raised through the live provider did not come back from listTickets');
  }
  for (let i = 1; i < list.length; i += 1) {
    if (list[i - 1].updatedAt < list[i].updatedAt) {
      failures.push('listTickets is not sorted newest-activity-first — the server sorts by creation, so the provider must re-sort on the derived updatedAt');
      break;
    }
  }
}

// ─── Both providers must answer the same shape ────────────────────────────────────────────────
const mockList = await mock.listTickets();
if (!Array.isArray(mockList)) failures.push('mock listTickets must resolve to an array');

// ─── Null-safety of the mapper ────────────────────────────────────────────────────────────────
if (toViewModel(null) !== null) failures.push('toViewModel(null) must be null, not a half-built object');
if (toMessage(null) !== null) failures.push('toMessage(null) must be null');
const defaults = toViewModel({ id: 't1', subject: 's' });
if (!Array.isArray(defaults.messages)) failures.push('toViewModel must default `messages` to an array');
if (defaults.priority !== '') failures.push('toViewModel must report priority as empty, never a fabricated default');
if (typeof defaults.updatedAt !== 'number') failures.push('toViewModel must always produce a numeric `updatedAt` — the list sorts on it');
// An unmapped server status must survive rather than be coerced onto a status the UI happens to
// know: `in-progress` means ops picked the ticket up, and collapsing it onto `open` would tell the
// customer nothing was happening while somebody was working on it.
const inProgress = toViewModel({ id: 't2', status: 'in-progress' });
if (inProgress.status !== 'in-progress') {
  failures.push(`an unknown status was coerced to ${JSON.stringify(inProgress.status)} — pass it through instead; erasing a distinction ops made is worse than an unstyled label`);
}

/**
 * Every role, driven through the mapper directly.
 *
 * The round trip above only exercises `buyer`, because the probe signs in as one — so a mapper that
 * wrongly treats `owner` as staff-side passes the live half of this harness untouched. That is not
 * hypothetical: it is the exact mutation this assertion was added to catch after the first version
 * missed it. An owner raising a support ticket is a customer of support, and getting this backwards
 * renders the reader's own words as if support had sent them.
 */
for (const [role, expected] of [['buyer', 'customer'], ['owner', 'customer'], [null, 'customer'], ['staff', 'staff'], ['admin', 'staff']]) {
  const side = toMessage({ id: 'm1', authorRole: role, body: 'x', createdAt: new Date().toISOString() }).by;
  if (side !== expected) {
    failures.push(`authorRole=${JSON.stringify(role)} mapped to the ${side} side, expected ${expected} — anything not staff-side is the person who raised the ticket`);
  }
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function assertTicketShape(t, what) {
  for (const f of ['id', 'subject', 'category', 'status']) {
    if (typeof t[f] !== 'string') failures.push(`${what} is missing \`${f}\` — the card renders it`);
  }
  if (!Array.isArray(t.messages)) failures.push(`${what} must carry a \`messages\` array`);
  if (typeof t.unread !== 'boolean') failures.push(`${what} must carry a boolean \`unread\``);
  if (typeof t.createdAt !== 'number' || typeof t.updatedAt !== 'number') {
    failures.push(`${what} must carry numeric \`createdAt\`/\`updatedAt\` — the list sorts and fmtTime formats`);
  }
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
  console.log('\n  PASS — mock and live support providers agree on every field the UI relies on.\n');
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
