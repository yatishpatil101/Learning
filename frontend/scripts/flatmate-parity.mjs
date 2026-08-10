/**
 * Flatmate parity — mock vs live for rooms, groups, seeker posts and requests.
 *
 * Run with the backend up:
 *
 *   node scripts/flatmate-parity.mjs --base http://localhost:8081/api --otp-log <backend log>
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * ## What is asserted
 *
 *   1. **Surface parity** — every function the service calls exists on both providers.
 *   2. **The three feeds are public** — they must answer for a caller with no session, because the
 *      page exists to convert exactly that visitor.
 *   3. **The closed vocabularies really are closed** — an unknown enum is 400 on the server, and
 *      the mock must refuse it too rather than accepting what the real thing rejects.
 *   4. **`@NotEmpty` is enforced** — a room with no photos and a post with no localities are both
 *      refused; they are the shape broker spam takes.
 *   5. **Joining an open group is accepted outright**, not left pending. This is the one place the
 *      mock was *stricter* than the server, which is just as wrong.
 *   6. **The request inbox is host-scoped** — a second identity's inbox must not contain it.
 *
 * Two identities are needed because half of this domain is one person asking another.
 *
 * Exit code 0 = the two agree, 1 = drift (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const stamp = String(Date.now()).slice(-5);
const HOST_MOBILE = args.get('host') || `93${stamp}${stamp.slice(0, 3)}`.slice(0, 10);
const SEEKER_MOBILE = args.get('seeker') || `92${stamp}${stamp.slice(0, 3)}`.slice(0, 10);

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);
console.log(`  host: ${HOST_MOBILE}   seeker: ${SEEKER_MOBILE}`);

const hostSession = await signIn(HOST_MOBILE);
const seekerSession = await signIn(SEEKER_MOBILE);

const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

function become(session) {
  if (!session) {
    globalThis.localStorage.removeItem('puneNestUser');
    globalThis.localStorage.removeItem('puneNestTokens');
    return;
  }
  globalThis.localStorage.setItem('puneNestUser', JSON.stringify({
    id: session.userId, name: session.name, mobile: session.mobile, role: 'seeker',
  }));
  globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
    accessToken: session.token, refreshToken: session.refreshToken,
  }));
}

become(hostSession);

const mock = await load('../src/services/providers/mock/flatmateProvider.js');
const live = await load('../src/services/providers/http/flatmateProvider.js');
const mapper = await load('../src/services/providers/http/flatmateMapper.js');

// ─── 1. Surface parity ────────────────────────────────────────────────────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── 2. The three feeds are public ────────────────────────────────────────────────────────────
// Asserted against the API directly with no Authorization header, because that is the visitor the
// page exists for. A 401 here means a signed-out person sees an empty Flatmates page.
for (const path of ['/flatmates/rooms', '/flatmates/groups', '/flatmates/posts']) {
  const res = await api('GET', path);
  if (res.status === 401 || res.status === 403) {
    failures.push(`${path} answered ${res.status} without a session — this feed is public, and a signed-out visitor is exactly who the Flatmates page exists to convert`);
  } else if (res.status >= 400) {
    failures.push(`${path} answered ${res.status} without a session: ${JSON.stringify(res.body)}`);
  }
}

// ─── 3. Closed vocabularies, and filters that actually filter ─────────────────────────────────
/* The server accepts **only** `locality`. Every other facet the page offers is silently ignored —
   200 with the unfiltered list, not 400. That is the worst failure mode available: a filter that
   appears to work and quietly does nothing tells someone who asked for women-only flats that these
   are the women-only flats.

   So the assertion is not "does an unknown enum 400" (it does not, and that is fine) but **does the
   filter narrow the result at all**. The first version of this check asked the wrong question and
   passed while the facets did nothing. */
const unfiltered = await api('GET', '/flatmates/rooms?size=200');
const serverIgnores = await api('GET', '/flatmates/rooms?size=200&gender=female');
if (unfiltered.status === 200 && serverIgnores.status === 200) {
  const a = (unfiltered.body?.content || []).length;
  const b = (serverIgnores.body?.content || []).length;
  if (a === b && a > 0) {
    warnings.push(`the server ignores ?gender (${a} rows with and without it) — expected, it filters on locality only, which is why the provider applies the other facets client-side`);
  }
}
// The provider must narrow where the server will not.
//
// Asserted as "every row that comes back matches the filter", not "fewer rows came back". The
// count-based version passed with the facet deliberately disabled, because a no-op filter returns
// the *same* count rather than a larger one — the same too-weak-probe mistake as the rent slice's
// fee check, caught the same way.
const allRooms = await live.listRooms({});
const femaleOnly = await live.listRooms({ gender: 'female' });
const violating = femaleOnly.items.filter((r) => r.gender !== 'female' && r.gender !== 'any');
if (violating.length) {
  failures.push(`filtering rooms by gender='female' returned ${violating.length} row(s) that are neither female nor any (${violating.map((r) => r.gender).join(', ')}) — the facet is not being applied, and the server ignores it, so nothing else will catch this`);
}
if (femaleOnly.total !== femaleOnly.items.length && femaleOnly.total > femaleOnly.items.length && femaleOnly.totalPages === 1) {
  failures.push('the filtered page reports a total larger than it can reach in one page while claiming one page');
}
// And a nonsense value must not silently exclude everything, which is the other way to be wrong.
const nonsense = await live.listRooms({ gender: 'Female' });
if (allRooms.total > 0 && nonsense.total !== allRooms.total) {
  failures.push(`an out-of-vocabulary gender changed the result count (${nonsense.total} vs ${allRooms.total}) — unknown values must be dropped, not matched, or a casing slip empties the page`);
}
const mockBadEnum = await mock.listRooms({ gender: 'Female' }).then(() => 'allowed').catch((e) => e.status);
if (mockBadEnum !== 400) {
  failures.push(`the mock returned ${mockBadEnum} for gender='Female', expected a 400 ApiError — note that constructing ApiError positionally leaves status undefined, which looks like this`);
}

// ─── 4. @NotEmpty is enforced on both sides ───────────────────────────────────────────────────
const noPhotos = await live.createRoom({
  roomType: 'Private room', locality: 'Aundh', rent: 12000, photos: [],
}).then(() => 'allowed').catch((e) => e.status);
if (noPhotos === 'allowed') {
  failures.push('a room with no photos was accepted — photos is @NotEmpty because a pictureless room is the shape broker spam takes');
}
const mockNoPhotos = await mock.createRoom({
  roomType: 'Private room', locality: 'Aundh', rent: 12000, photos: [],
}).then(() => 'allowed').catch((e) => e.status);
if (mockNoPhotos === 'allowed') {
  failures.push('the mock accepted a room with no photos, which the server refuses');
}
const noLocalities = await live.createPost({ name: 'Parity Probe', budget: 15000, localities: [] })
  .then(() => 'allowed').catch((e) => e.status);
if (noLocalities === 'allowed') {
  failures.push('a seeker post with no localities was accepted — localities is @NotEmpty, and a seeker who will live anywhere matches nobody');
}

// ─── A real room, so the rest has something to act on ─────────────────────────────────────────
const room = await live.createRoom({
  roomType: 'Private room',
  attachedBath: 'attached',
  furnishing: 'semi',
  bhk: '2',
  locality: 'Aundh',
  rent: 14000,
  deposit: 28000,
  hostRole: 'tenant',
  lookingFor: 'any',
  foodPref: 'any',
  photos: ['https://example.test/room.jpg'],
  note: 'flatmate parity probe',
}).catch((e) => { failures.push(`createRoom failed: ${e.status} ${JSON.stringify(e.body)}`); return null; });

if (room) {
  for (const [field, type] of Object.entries({ id: 'string', budget: 'number', locality: 'string', modStatus: 'string' })) {
    if (typeof room[field] !== type) failures.push(`live room.${field} is ${typeof room[field]}, expected ${type}`);
  }
  // The money field keeps the wire's name, `budget`, because that is also what every card, filter
  // and map pin on the Flatmates page reads. Renaming it in the seam rendered ₹0 on every room.
  if (room.budget !== 14000) {
    failures.push(`the room's budget came back ${room.budget}, expected 14000 — the page reads 'budget' on rooms and seeker posts (only groups carry 'rent'), so a rename here shows ₹0 on every card`);
  }
  if (!room.publiclyVisible) {
    warnings.push(`a freshly created room is not publiclyVisible (modStatus=${room.modStatus})`);
  }
}

// ─── A group, to test the join-policy inversion ───────────────────────────────────────────────
const group = await live.createGroup({
  title: `Parity probe group ${stamp}`,
  locality: 'Aundh',
  policy: 'any',
  rent: 45000,
  seatsTotal: 3,
  seatsOpen: 2,
  name: 'Parity Host',
  hostRole: 'tenant',
}).catch((e) => { failures.push(`createGroup failed: ${e.status} ${JSON.stringify(e.body)}`); return null; });

if (group) {
  // 5. An OPEN group accepts a join outright. The mock used to always return `pending`, which would
  // show "waiting for approval" for a join that had already succeeded.
  become(seekerSession);
  const joined = await live.joinGroup(group.id, { share: 'solo', message: 'parity probe' })
    .catch((e) => { failures.push(`joinGroup failed: ${e.status} ${JSON.stringify(e.body)}`); return null; });
  if (joined) {
    if (joined.action !== 'join') {
      failures.push(`joining produced action='${joined.action}', expected 'join'`);
    }
    if (joined.status !== 'accepted') {
      failures.push(`joining an OPEN-policy group produced status='${joined.status}', expected 'accepted' — the server accepts outright and stamps decidedAt, so a UI that says "waiting for approval" would be wrong`);
    }
    if (joined.awaitingDecision) {
      failures.push('an accepted join reports awaitingDecision=true — the inbox would show it as needing a decision it has already had');
    }
  }
  become(hostSession);
}

// ─── 6. The request inbox is host-scoped ──────────────────────────────────────────────────────
const hostInbox = await live.myRequests();
become(seekerSession);
const seekerInbox = await live.myRequests();
if (group && seekerInbox.some((r) => r.targetId === group.id)) {
  failures.push('the seeker\'s /me/flatmate-requests contains a request against the host\'s group — this inbox is scoped by host, not by participant');
}
become(hostSession);
if (!Array.isArray(hostInbox)) failures.push('myRequests did not return an array');
// A positive assertion, deliberately. The scoping check above and the isArray check both pass on an
// empty list, so between them they would have said nothing when D77 paged this endpoint and the
// provider kept reading the response as a bare array — every host would have seen an empty inbox
// and the harness would have been green. The seeker joined the host's group a few lines up, so the
// host's inbox has to contain exactly that.
if (group && !hostInbox.some((r) => r.targetId === group.id)) {
  failures.push('the host\'s /me/flatmate-requests does not contain the join that just happened — if it is also empty, the page envelope is not being unwrapped');
}

// ─── The mapper's derived fields ──────────────────────────────────────────────────────────────
// Seats are set by the host, never inferred from membership: a group can have 3 members and 2 open
// seats (growing) or 4 and none (full). Deriving it would be wrong in both directions.
if (mapper.seatsLeftOf({ seatsOpen: 2, seatsTotal: 4, members: [1, 2, 3] }) !== 2) {
  failures.push('seatsLeftOf ignored seatsOpen in favour of arithmetic — the host sets seats; membership is a separate fact');
}
if (mapper.seatsLeftOf({ seatsTotal: 4, members: [1, 2] }) !== 2) {
  failures.push('seatsLeftOf did not fall back to seatsTotal - members for a legacy row with no seatsOpen');
}
if (mapper.isPubliclyVisible('flagged') || mapper.isPubliclyVisible('removed') || mapper.isPubliclyVisible('rejected')) {
  failures.push('isPubliclyVisible treated a moderated-away row as visible');
}
if (!mapper.isPubliclyVisible('live') || !mapper.isPubliclyVisible('approved')) {
  failures.push('isPubliclyVisible hid a live row');
}
if (mapper.perHeadOf({ rent: 45000, seatsTotal: 3 }) !== 15000) {
  failures.push('perHeadOf miscomputed the per-head share');
}
if (mapper.vocab('gender', 'Female') !== undefined) {
  failures.push('vocab() passed an out-of-set value through; it must drop it so the request is not spent earning a 400');
}
if (mapper.vocab('gender', 'female') !== 'female') {
  failures.push('vocab() dropped a valid value');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

async function signIn(mobile) {
  await api('POST', '/auth/login', { mobile });
  const otp = await readOtp(mobile);
  const res = await api('POST', '/auth/login', { mobile, otp });
  if (res.status !== 200) {
    console.error(`\n  Live login failed for ${mobile} (HTTP ${res.status}): ${JSON.stringify(res.body)}\n`);
    process.exit(1);
  }
  return {
    mobile,
    name: `Parity ${mobile.slice(-4)}`,
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user?.id,
  };
}

async function api(method, path, body, bearer) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  const text = await res.text();
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed };
}

/** Read the newest OTP for a mobile out of the backend console log, or prompt for it. */
async function readOtp(mobile) {
  const logPath = args.get('otp-log');
  if (logPath) {
    const { readFileSync } = await import('node:fs');
    const txt = readFileSync(logPath, 'utf8');
    const re = new RegExp(`${mobile}[^\\n]*?(\\d{6})`, 'g');
    let last = null;
    let m;
    while ((m = re.exec(txt)) !== null) last = m[1];
    if (last) return last;
    console.error(`\n  No OTP for ${mobile} in ${logPath}. Is that the log of the backend you started?\n`);
    process.exit(1);
  }
  process.stdout.write(`  OTP for ${mobile}: `);
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
      key: (i) => Array.from(map.keys())[i] ?? null,
      get length() { return map.size; },
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

function report(fatal) {
  console.log('');
  if (warnings.length) {
    console.log(`  ${warnings.length} tolerated difference(s):`);
    warnings.forEach((w) => console.log(`    ~ ${w}`));
    console.log('');
  }
  if (!failures.length && !fatal) {
    console.log('  PASS — mock and live flatmate providers agree, and the server enforces the rules the UI depends on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} difference(s):`);
  failures.forEach((f) => console.log(`    x ${f}`));
  console.log('');
  process.exit(1);
}
