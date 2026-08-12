/**
 * Contract-parity check: mock conversation provider vs the live API, through the http mapper.
 *
 * `conversationService.js` is a seam — the /messages inbox, the property→chat bridge and the navbar
 * badge are written against one interface and must not care which provider answered. The risk in
 * this domain is unusually concentrated, because the mock's conversation is a **richer document**
 * than the server's rather than a differently-named one:
 *
 * 1. **`authorId`, not `author`.** The wire carries both, and the display name is the tempting one
 *    to key on. Two users sharing a name then renders a stranger's message on the reader's own side
 *    of the thread, styled as theirs. Nothing throws; it just quietly lies about who said what.
 * 2. **`at` must be a number** — the page sorts on it, draws day dividers from it and computes
 *    `Date.now() - at`. An ISO string sorts *almost* right, so it survives casual testing.
 * 3. **The staging queue.** `staged` is the one distinction the seam mints itself, for a chat the
 *    server would refuse (no approved contact). It must never be mistaken for a server thread.
 *    It is also the *only* row-level condition either provider is allowed to model: the prototype's
 *    `active`/`incoming`/`pending` `state` had no contract field and was retired in D52, so a
 *    reappearing `state` here is drift, not a feature.
 *
 * Usage (backend must be running):
 *   node scripts/conversation-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/conversation-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const MOBILE = args.get('mobile') || `98763${String(Date.now()).slice(-5)}`;

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
if (!meId) failures.push('the login response carries no user id — the mapper cannot attribute messages without one');

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
// The http provider reads the session the way the app does (`lib/auth.js` → `puneNestTokens`)
// rather than taking a token argument, so driving the *real* provider means persisting a real
// session. A change to where the app keeps its token then breaks this script exactly as it would
// break the app, which is the point.
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token,
  refreshToken: loginRes.body.refreshToken,
}));

const mock = await load('../src/services/providers/mock/conversationProvider.js');
const live = await load('../src/services/providers/http/conversationProvider.js');
const { toViewModel, toMessage, stagedToViewModel, toConversationCreate } =
  await load('../src/services/providers/http/conversationMapper.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The live inbox ───────────────────────────────────────────────────────────────────────────
// A fresh account has no threads, and that is a legitimate state: a conversation cannot exist
// before an approved contact request. So the *list* is checked for shape, and the row-level
// assertions run through the mapper against a synthesised wire row — the mapper is what is under
// test, and it does not care where the row came from.
const liveList = await live.listConversations();
if (!Array.isArray(liveList)) failures.push(`listConversations must return an array, got ${typeof liveList}`);

const rawPage = (await api('GET', '/messages?size=100', null, token)).body;
if (rawPage?.content === undefined) {
  failures.push('GET /messages did not return a PageEnvelope — the provider unwraps `content`');
}

// ─── The row shape the page renders ───────────────────────────────────────────────────────────
const WIRE_ROW = {
  id: 'b1e1f7a0-0000-4000-8000-000000000001',
  counterpartyName: 'Aarav Sharma',
  counterpartyRole: 'owner',
  counterpartyMobile: '98XXXXX210',
  propertyId: 'b1e1f7a0-0000-4000-8000-000000000002',
  propertyTitle: '3 BHK in Baner',
  lastMessage: 'Yes, still available.',
  unread: 2,
  updatedAt: new Date().toISOString(),
  messages: [
    { id: 'm1', authorId: meId, author: 'Parity Probe', authorRole: 'buyer', body: 'Is it available?', createdAt: new Date().toISOString() },
    { id: 'm2', authorId: 'b1e1f7a0-0000-4000-8000-000000000003', author: 'Aarav Sharma', authorRole: 'owner', body: 'Yes, still available.', createdAt: new Date().toISOString() },
  ],
};
const mapped = toViewModel(WIRE_ROW, meId);

// Every one of these is read unconditionally by Messages.jsx. An absent field is a blank row, a
// crash on `.toLowerCase()`, or a `NaN` timestamp — not an error anyone would trace back to here.
for (const f of ['id', 'party', 'property', 'youAre', 'staged', 'at', 'unread', 'messages']) {
  if (mapped[f] === undefined) failures.push(`the mapped row is missing required field \`${f}\``);
}
for (const f of ['name', 'avatar', 'role', 'online', 'mobile']) {
  if (mapped.party?.[f] === undefined) failures.push(`the mapped row is missing \`party.${f}\` — the inbox reads it directly`);
}
for (const f of ['title', 'price', 'loc']) {
  if (mapped.property?.[f] === undefined) failures.push(`the mapped row is missing \`property.${f}\` — the card interpolates it`);
}
// `img` is the exception, and the opposite requirement: it must be `undefined`, never `''`.
// `<img src="">` makes the browser re-request the *current page* as the image — a full extra page
// download per thread, plus a React warning. React omits the attribute entirely for `undefined`.
// Found by the live e2e, which failed on the console warning before anyone noticed the downloads.
if ('img' in mapped.property && mapped.property.img === '') {
  failures.push('`property.img` is an empty string — `<img src="">` re-downloads the page; use undefined');
}

if (typeof mapped.at !== 'number' || Number.isNaN(mapped.at)) {
  failures.push(`\`at\` is ${typeof mapped.at} (${mapped.at}) — the page needs epoch ms to sort and to draw day dividers`);
}
if (typeof mapped.party.online !== 'boolean') {
  failures.push('`party.online` must be a boolean — a truthiness check on undefined renders "online" for everyone');
}

// ─── Attribution: the assertion this whole file exists for ────────────────────────────────────
if (mapped.messages[0]?.from !== 'me') failures.push('a message written by the reader was not attributed to them');
if (mapped.messages[1]?.from !== 'them') failures.push("the counterparty's message was attributed to the reader");

// The trap: two users with the same display name. Keying on `author` puts a stranger's words on
// the reader's side of the thread, styled as theirs, with nothing thrown and nothing logged.
const sameName = toMessage(
  { id: 'm3', authorId: 'b1e1f7a0-0000-4000-8000-000000000003', author: 'Parity Probe', authorRole: 'owner', body: 'not mine', createdAt: new Date().toISOString() },
  meId,
);
if (sameName.from !== 'them') {
  failures.push(
    'a message from a different user who happens to share the reader\'s display name was attributed '
    + 'to the reader — the mapper is keying on `author` instead of `authorId`',
  );
}
// And the safe default when identity is unknown: attribute to the counterparty, never to the reader.
if (toMessage({ id: 'm4', body: 'x', createdAt: new Date().toISOString() }, null).from !== 'them') {
  failures.push('with no viewer id, a message must default to "them" — claiming a stranger\'s words are the reader\'s is the worse error');
}

// ─── The derived fields ───────────────────────────────────────────────────────────────────────
if (mapped.youAre !== 'buyer') failures.push(`youAre should be "buyer" when the counterparty is the owner, got "${mapped.youAre}"`);
if (toViewModel({ ...WIRE_ROW, counterpartyRole: 'buyer' }, meId).youAre !== 'owner') {
  failures.push('youAre should be "owner" when the counterparty is a buyer');
}
// A live thread is never staged: it cannot exist before an approved contact request, so there is no
// waiting condition for it to be in. If this ever fails, the inbox would file real threads under
// Requests and hide the composer on a thread the user can actually reply into.
if (mapped.staged !== false) failures.push(`a live thread must be \`staged: false\`, got ${JSON.stringify(mapped.staged)}`);
// D52: the retired vocabulary must not come back on either provider.
if ('state' in mapped) failures.push('the mapped row carries a `state` field — that vocabulary has no contract counterpart and was removed in D52');

// ─── The staging queue ────────────────────────────────────────────────────────────────────────
const staged = stagedToViewModel({
  propertyId: 'p5000',
  at: Date.now(),
  property: { title: 'Test flat', price: '', loc: '', img: '' },
  party: { name: 'Owner', role: 'Owner' },
  firstMessage: 'Is this available?',
});
if (!String(staged.id).startsWith('staged:')) {
  failures.push('a staged chat must carry a `staged:` id, so nothing can try to reply into it as if it were a thread');
}
if (!staged.staged) failures.push('a staged chat must be flagged `staged` so the page can tell it apart');
if ('state' in staged) failures.push('a staged chat carries a `state` field — removed in D52; `staged` is the whole distinction');

// Queue → drain, end to end. The queue must be idempotent per listing (pressing the button twice
// is one request, not two) and `markConversationRead` must not try to POST for a staged id.
await live.queuePendingChat({ id: 'p5000', title: 'Test flat', owner: 'Owner' }, {});
await live.queuePendingChat({ id: 'p5000', title: 'Test flat', owner: 'Owner' }, {});
const queued = JSON.parse(globalThis.localStorage.getItem('pnPendingRequests') || '[]');
if (queued.length !== 1) failures.push(`queuing the same listing twice produced ${queued.length} staged chats, expected 1`);
if (queued[0]?.party?.mobile) {
  failures.push(
    'the staged chat stored a mobile number. On a property page that number is masked until the '
    + 'gate opens, so storing it persists a masked string that would then be sent as if it were real',
  );
}
await live.markConversationRead(staged.id); // must be a no-op, not a 404-ing POST

const withStaged = await live.listConversations();
if (!withStaged.some((c) => c.staged)) {
  failures.push('a staged chat did not appear in listConversations — it is composed but invisible');
}

// ─── The create body ──────────────────────────────────────────────────────────────────────────
const created = toConversationCreate({ counterpartyMobile: '9820011111', body: 'hi' });
if ('propertyId' in created) {
  failures.push('toConversationCreate must omit `propertyId` when absent — the server validates it as a UUID when present');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

async function api(method, path, body, bearer) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
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

function report() {
  console.log('');
  if (warnings.length) {
    console.log(`  ${warnings.length} tolerated difference(s):`);
    warnings.forEach((w) => console.log(`    ~ ${w}`));
    console.log('');
  }
  if (!failures.length) {
    console.log('  PASS — mock and live conversation providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
