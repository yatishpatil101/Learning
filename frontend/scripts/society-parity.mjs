/**
 * Contract-parity check: mock society provider vs the live API, for the **ops half** of the domain.
 *
 * `societyService.js` is a seam, and `AdminSocieties.jsx` is written against four of its exports —
 * `listSocietyClaimQueue`, `decideSocietyClaim`, `listSocietyProposalQueue`,
 * `decideSocietyProposal` — without knowing which provider answered. Those four had no harness
 * while the other eighteen domains did, and that gap is not an accounting detail: it is why a
 * fabricated 409 could sit in the mock's `decideSocietyClaim` with nothing comparing it against the
 * server, which until recently threw nothing at all there. The two ends agreeing about a conflict
 * is exactly the kind of fact only a harness notices.
 *
 * What is pinned here:
 *
 * 1. **Both queues answer a flat array, not a page envelope.** The console counts and groups over
 *    the whole set (`rows.filter(…).length` beside each heading), so a `{items,total}` on one side
 *    is a `.filter is not a function` on exactly one build. The mock used to answer `{items,total}`
 *    for proposals, harmless right up until something consumed it.
 * 2. **The rows carry the same field names.** `SocietyClaimResponse` and `SocietyProposalResponse`
 *    are the wire; the mock translates its slug-keyed store into them by hand. A hand translation
 *    with nothing diffing it is a list of columns that render on one build and read `undefined` on
 *    the other.
 * 3. **A decision returns the decided row**, with the status the caller asked for — the console
 *    replaces the row in place rather than refetching, so a decision that answers the *old* status
 *    leaves an approved claim drawn as pending until somebody reloads.
 * 4. **Deciding twice is a 409 on both sides.** This is the assertion the gap was hiding. A second
 *    decision would either re-grant a building's residency register to somebody an operator already
 *    rejected, or double-apply a proposal; the mock said 409 and the server, until
 *    `SocietyMembershipService.decideClaim` grew a `ConflictException`, did not. Verified against
 *    the running server rather than assumed.
 * 5. **Both admin queues are staff-only.** A consumer session must meet 403, not an empty queue: an
 *    empty ops queue reads as "nothing waiting", which is precisely the false negative that made
 *    all three community features theatre while they wrote into the author's own browser.
 *
 * ## Two deliberate divergences, asserted separately rather than forced to agree
 *
 * - **The mock's proposal queue enumerates only `pending`.** Its store keeps one record per society
 *   per kind and its three queue readers all filter to pending, so a decided proposal is reachable
 *   by slug and not by the queue. Asking for `status:'approved'` therefore answers `[]` here and
 *   answers real rows live. Documented in `mock/societyProvider.js`; asserted below as the
 *   documented shape on each side, because papering over it would mean the mock returning its
 *   *pending* rows for an `approved` query — telling an operator a rejected group link is still up.
 * - **The mock has no claim history.** Its store is keyed by slug, so re-claiming after a rejection
 *   overwrites rather than appending, and the queue can never show one society twice. Nothing here
 *   depends on it; it is named so the next reader does not add an assertion that cannot hold.
 *
 * Usage (backend must be running):
 *   node scripts/society-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/society-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
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
const MOBILE = args.get('mobile') || `98763${String(Date.now()).slice(-5)}`;
/**
 * The seeded platform admin.
 *
 * Admin rather than a `staff` account, and not by preference: both admin routes are gated on the
 * `societies:read` / `societies:write` atoms and no seeded staff team holds them. This is the same
 * account, for the same stated reason, that `e2e/tests/live-society-residency.spec.js` uses.
 */
const OPS_MOBILE = args.get('ops') || '9000000000';

/** The server's vocabularies, from `SocietyProposalKinds` and the two decision records. */
const KINDS = ['details', 'whatsapp', 'location'];
const STATUSES = ['pending', 'approved', 'rejected'];

/** `services/apiLimits.js` — the size both http queue readers ask for, and so the page stride. */
const MAX_PAGE_SIZE = 100;

/**
 * Refuse a `--base` that is not loopback.
 *
 * This harness does not merely read. It signs in as the seeded platform admin, mints societies,
 * files claims and then *approves* one — and an approval hands a building's residency register to
 * whoever filed it. Aimed at a shared or production API by a mistyped or copy-pasted `--base`,
 * that damage is already done by the time the run prints anything, so a check afterwards is no
 * check at all. Nothing in this file stood in the way until now: the only obstacles were
 * backend-side (a dev-only seeded admin, a dev-only mock OTP sender), and a script may not assume
 * the environment it was pointed at shares them.
 *
 * The host test itself lives in `lib-assert-local-base.mjs`, shared with the runner and the other
 * nineteen harnesses — see there for why it parses rather than substring-matches.
 */
assertLoopbackBase(
  BASE,
  args.has('i-know-what-im-doing'),
  'This harness makes authority-granting admin writes — it approves a society claim, which'
  + '\n  reassigns real residents — so it may only run against a backend on this machine.',
);

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);

// ─── Sign in: one ordinary member who proposes and claims, one operator who decides ────────────
const member = await signIn(MOBILE);
const ops = await signIn(OPS_MOBILE);

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

useSession(member);

const mock = await load('../src/services/providers/mock/societyProvider.js');
// The mock reads a seed that is fetched asynchronously, and every read throws until it lands — in
// the browser `main.jsx` awaits this before rendering, and a script has to do the same.
await (await load('../src/lib/mockApi.js')).ensureMockDb();
const live = await load('../src/services/providers/http/societyProvider.js');

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);
for (const op of ['listSocietyClaimQueue', 'decideSocietyClaim', 'listSocietyProposalQueue', 'decideSocietyProposal']) {
  if (typeof live[op] !== 'function') failures.push(`http provider must export \`${op}\``);
  if (typeof mock[op] !== 'function') failures.push(`mock provider must export \`${op}\``);
}

const stamp = Date.now();

// ─── The mock round trip ──────────────────────────────────────────────────────────────────────
// Its own society, minted rather than borrowed from the seed: a claim is one-per-society and a
// details proposal is one-per-society-per-kind, so re-running this against a shared row would
// decide something a previous run left pending and read as flakiness rather than as a collision.
const mockSlug = (await mock.mintSociety({ name: `Parity Probe Society ${stamp}` })).society.slug;
const mockClaim = await mock.claimSociety(mockSlug, {
  name: 'Parity Probe', role: 'secretary', email: 'probe@example.test', note: 'Parity probe.',
});
const mockProposal = await mock.proposeSocietyChange(mockSlug, {
  kind: 'details', builder: 'Parity Builders', buildYear: 2011, towers: 3,
});

const mockClaims = await mock.listSocietyClaimQueue({ status: 'pending' });
const mockProposals = await mock.listSocietyProposalQueue({ status: 'pending', kind: 'details' });
assertFlatArray(mockClaims, 'mock listSocietyClaimQueue');
assertFlatArray(mockProposals, 'mock listSocietyProposalQueue');

const mockClaimRow = mockClaims.find((c) => c.societySlug === mockSlug);
const mockProposalRow = mockProposals.find((p) => p.societySlug === mockSlug);
if (!mockClaimRow) failures.push('the claim just filed is not in the mock queue — an ops queue that cannot see a fresh claim is the defect the live queue was built to fix');
if (!mockProposalRow) failures.push('the proposal just filed is not in the mock queue');

// ─── The live round trip, as the member ───────────────────────────────────────────────────────
const liveSlug = (await live.mintSociety({ name: `Parity Probe Society ${stamp}` })).society.slug;
const liveClaim = await live.claimSociety(liveSlug, {
  name: 'Parity Probe', role: 'secretary', email: 'probe@example.test', note: 'Parity probe.',
});
const liveProposal = await live.proposeSocietyChange(liveSlug, {
  kind: 'details', builder: 'Parity Builders', buildYear: 2011, towers: 3,
});

// ─── Both admin queues are staff-only ─────────────────────────────────────────────────────────
// Through the raw API rather than the provider: the provider would throw either way, and the
// distinction that matters is 403-not-200. An accessible-but-empty ops queue looks like "nothing
// waiting", which is how three community features stayed unactioned for months.
for (const path of ['/admin/society-claims', '/admin/society-proposals']) {
  const asMember = await api('GET', path, null, member.token);
  if (asMember.status !== 403) {
    failures.push(`GET ${path} answered ${asMember.status} to an ordinary member, expected 403 — an ops queue a member can read is one they can also see other people's mobiles in, and an empty one reads as "nothing to do"`);
  }
}

// ─── The live queues, as the operator ─────────────────────────────────────────────────────────
useSession(ops);

const liveClaims = await live.listSocietyClaimQueue({ status: 'pending' });
const liveProposals = await live.listSocietyProposalQueue({ status: 'pending', kind: 'details' });
assertFlatArray(liveClaims, 'http listSocietyClaimQueue');
assertFlatArray(liveProposals, 'http listSocietyProposalQueue');

// Oldest first on both — the queue's whole ordering promise, and the one a newest-first default
// would silently invert, burying the claim somebody has waited longest on.
assertOldestFirst(mockClaims, 'the mock claim queue');
assertOldestFirst(liveClaims, 'the live claim queue');
assertOldestFirst(mockProposals, 'the mock proposal queue');
assertOldestFirst(liveProposals, 'the live proposal queue');

// The queue is paged on the wire and ordered oldest first, so a row filed a second ago is on the
// *last* page. Walking rather than trusting page 0 is the difference between "the queue cannot see
// it" and "the queue has more than a hundred pending claims".
const liveClaimRow = await findInQueue(live.listSocietyClaimQueue, { status: 'pending' }, (c) => c.id === liveClaim.id);
const liveProposalRow = await findInQueue(live.listSocietyProposalQueue, { status: 'pending', kind: 'details' }, (p) => p.id === liveProposal.id);
if (!liveClaimRow) failures.push('the claim just filed is not in the live queue — the queue reads a different set from the one the claim endpoint writes');
if (!liveProposalRow) failures.push('the proposal just filed is not in the live queue');

// ─── Field-name agreement, row against row ────────────────────────────────────────────────────
compareKeys(mockClaimRow, liveClaimRow, 'a claim queue row');
compareKeys(mockProposalRow, liveProposalRow, 'a proposal queue row');
compareTypes(mockClaimRow, liveClaimRow, 'a claim queue row');
compareTypes(mockProposalRow, liveProposalRow, 'a proposal queue row');

// The fields the console actually renders, named so a key-set diff that agrees on the *wrong* set
// still fails. `claimantMobile` is the one the public membership read redacts and this one must
// not: deciding a claim means phoning the person who filed it.
for (const [row, what] of [[mockClaimRow, 'the mock claim row'], [liveClaimRow, 'the live claim row']]) {
  assertClaimShape(row, what);
}
for (const [row, what] of [[mockProposalRow, 'the mock proposal row'], [liveProposalRow, 'the live proposal row']]) {
  assertProposalShape(row, what);
}

// ─── The decision returns the decided row, with the status that was asked for ─────────────────
const mockDecidedClaim = await mock.decideSocietyClaim(mockClaim.id, { status: 'approved' });
const liveDecidedClaim = await live.decideSocietyClaim(liveClaim.id, { status: 'approved' });
for (const [row, what] of [[mockDecidedClaim, 'the mock decided claim'], [liveDecidedClaim, 'the live decided claim']]) {
  assertClaimShape(row, what);
  if (row?.status !== 'approved') {
    failures.push(`${what} came back as ${JSON.stringify(row?.status)} — the console swaps the row in place rather than refetching, so a decision answering the old status draws an approved claim as still pending`);
  }
}
compareKeys(mockDecidedClaim, liveDecidedClaim, 'a decided claim');

const mockDecidedProposal = await mock.decideSocietyProposal(mockProposal.id, { status: 'approved' });
const liveDecidedProposal = await live.decideSocietyProposal(liveProposal.id, { status: 'approved' });
for (const [row, what] of [[mockDecidedProposal, 'the mock decided proposal'], [liveDecidedProposal, 'the live decided proposal']]) {
  assertProposalShape(row, what);
  if (row?.status !== 'approved') {
    failures.push(`${what} came back as ${JSON.stringify(row?.status)}, expected "approved"`);
  }
}
compareKeys(mockDecidedProposal, liveDecidedProposal, 'a decided proposal');

// Approving a details proposal writes the value onto the society in the same transaction — there
// is no separate apply step. Asserted on the live side only: the mock's "society" is a localStorage
// overlay, and `mintSociety` there answers the overlay-merged row, so this would be checking the
// store against itself.
if (liveDecidedProposal?.builder !== 'Parity Builders') {
  failures.push(`the decided proposal lost its \`builder\` (${JSON.stringify(liveDecidedProposal?.builder)}) — the decision response is what the console redraws, and a blank field there reads as a proposal that carried nothing`);
}

// ─── Deciding twice: the assertion the missing harness was hiding ─────────────────────────────
for (const [decide, id, what] of [
  [mock.decideSocietyClaim, mockClaim.id, 'mock decideSocietyClaim'],
  [live.decideSocietyClaim, liveClaim.id, 'http decideSocietyClaim'],
]) {
  const status = await statusOfRejection(() => decide(id, { status: 'rejected' }));
  if (status !== 409) {
    failures.push(`${what} answered ${describeStatus(status)} to a second decision, expected 409 — re-deciding rewrites who handed the building over, and re-approving a rejected claim passes a society's residency register to somebody an operator already turned down`);
  }
}
for (const [decide, id, what] of [
  [mock.decideSocietyProposal, mockProposal.id, 'mock decideSocietyProposal'],
  [live.decideSocietyProposal, liveProposal.id, 'http decideSocietyProposal'],
]) {
  const status = await statusOfRejection(() => decide(id, { status: 'rejected' }));
  if (status !== 409) {
    failures.push(`${what} answered ${describeStatus(status)} to a second decision, expected 409 — the second decision either double-applies the change or silently reverts the one the author has already been told about`);
  }
}

// ─── A decision on a row that does not exist ──────────────────────────────────────────────────
// Both must say 404 rather than inventing a row. A mock that quietly succeeds here would let a
// console bug — a stale id from a list the operator has not reloaded — pass every mock spec.
for (const [decide, what] of [
  [mock.decideSocietyClaim, 'mock decideSocietyClaim'],
  [live.decideSocietyClaim, 'http decideSocietyClaim'],
]) {
  const status = await statusOfRejection(() => decide('00000000-0000-4000-8000-000000000000', { status: 'approved' }));
  if (status !== 404) {
    failures.push(`${what} answered ${describeStatus(status)} for an unknown id, expected 404`);
  }
}
for (const [decide, what] of [
  [mock.decideSocietyProposal, 'mock decideSocietyProposal'],
  [live.decideSocietyProposal, 'http decideSocietyProposal'],
]) {
  const status = await statusOfRejection(() => decide('00000000-0000-4000-8000-000000000000', { status: 'approved' }));
  if (status !== 404) {
    failures.push(`${what} answered ${describeStatus(status)} for an unknown id, expected 404`);
  }
}

// ─── The vocabularies ─────────────────────────────────────────────────────────────────────────
// A `kind` outside the set is a tab the console never draws, and a `status` outside it is a filter
// that silently empties. Read off whatever both queues actually returned rather than only off the
// rows this run created, so a seeded row with a stale word is caught too.
for (const [rows, what] of [[mockProposals, 'the mock proposal queue'], [liveProposals, 'the live proposal queue']]) {
  for (const row of rows) {
    if (!KINDS.includes(row.kind)) {
      failures.push(`${what} returned kind ${JSON.stringify(row.kind)}, outside ${KINDS.join('|')} — the console tabs on this word, so anything else is a row nobody can see`);
    }
  }
}
for (const [rows, what] of [
  [mockClaims, 'the mock claim queue'], [liveClaims, 'the live claim queue'],
  [mockProposals, 'the mock proposal queue'], [liveProposals, 'the live proposal queue'],
]) {
  for (const row of rows) {
    if (!STATUSES.includes(row.status)) {
      failures.push(`${what} returned status ${JSON.stringify(row.status)}, outside ${STATUSES.join('|')}`);
    }
  }
}

// ─── The two documented divergences, asserted on each side rather than forced to agree ────────

// The mock's proposal queue enumerates pending only; the live one enumerates everything.
const mockDecidedQueue = await mock.listSocietyProposalQueue({ status: 'approved' });
assertFlatArray(mockDecidedQueue, 'mock listSocietyProposalQueue({status:"approved"})');
if (mockDecidedQueue.length) {
  failures.push('mock listSocietyProposalQueue({status:"approved"}) returned rows — its store keeps one record per society per kind and its readers filter to pending, so the documented answer is empty. Returning the *pending* set for a decided query would tell an operator a rejected group link is still live.');
}
const liveDecidedQueue = await findInQueue(live.listSocietyProposalQueue, { status: 'approved' }, (p) => p.id === liveProposal.id);
if (!liveDecidedQueue) {
  failures.push('the live proposal queue cannot find the proposal it just approved under status:"approved" — the decided-row history is the half of this queue the mock deliberately does not have, so if it is missing live it exists nowhere');
}

// The claim queue *does* enumerate decided rows on both sides — the mock filters on the stored
// status rather than short-circuiting — so this one is a true parity assertion, not a divergence.
const mockApprovedClaims = await mock.listSocietyClaimQueue({ status: 'approved' });
assertFlatArray(mockApprovedClaims, 'mock listSocietyClaimQueue({status:"approved"})');
if (!mockApprovedClaims.some((c) => c.societySlug === mockSlug)) {
  failures.push('the mock claim queue cannot find the claim it just approved — the console\'s Approved tab would sit empty on a mock build while the live one fills');
}
const liveApprovedClaim = await findInQueue(live.listSocietyClaimQueue, { status: 'approved' }, (c) => c.id === liveClaim.id);
if (!liveApprovedClaim) {
  failures.push('the live claim queue cannot find the claim it just approved under status:"approved"');
}

// ─── Refusing a decision that is neither approved nor rejected ────────────────────────────────
// Recorded rather than asserted equal. Both refuse, which is what protects the data; they refuse
// with different codes, and the console has no path that sends a third word — every call site is a
// literal. Failing on it would demand a change in `mock/societyProvider.js`, which is not what this
// harness is for; leaving it unmentioned is how it becomes a surprise the day somebody adds a
// "needs more info" outcome.
{
  const mockCode = await statusOfRejection(() => mock.decideSocietyClaim(mockClaim.id, { status: 'nonsense' }));
  const liveCode = await statusOfRejection(() => live.decideSocietyClaim(liveClaim.id, { status: 'nonsense' }));
  if (mockCode !== liveCode) {
    warnings.push(`an unknown decision word is ${describeStatus(mockCode)} on the mock and ${describeStatus(liveCode)} live — both refuse, and no call site can produce one, so this is recorded rather than failed`);
  }
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** The fields `AdminSocieties.jsx` renders for a claim, plus the contact ops decides on. */
function assertClaimShape(c, what) {
  if (!c) return;
  for (const f of ['id', 'societySlug', 'societyName', 'claimantName', 'status']) {
    if (typeof c[f] !== 'string') failures.push(`${what} is missing \`${f}\` — the queue renders it`);
  }
  if (!('claimantMobile' in c)) {
    failures.push(`${what} has no \`claimantMobile\` — this read is the one place it is populated, because deciding a claim means phoning the person who filed it`);
  }
  if (typeof c.createdAt !== 'string') {
    failures.push(`${what} must carry an ISO \`createdAt\` — the queue is ordered and aged by it`);
  }
}

/** The fields the console renders for a proposal, whatever its kind. */
function assertProposalShape(p, what) {
  if (!p) return;
  for (const f of ['id', 'societySlug', 'kind', 'status']) {
    if (typeof p[f] !== 'string') failures.push(`${what} is missing \`${f}\` — the queue renders it`);
  }
  if (typeof p.authorIsResident !== 'boolean') {
    failures.push(`${what} must carry a boolean \`authorIsResident\` — it is recomputed on every read and the row is drawn from it`);
  }
  if (typeof p.createdAt !== 'string') {
    failures.push(`${what} must carry an ISO \`createdAt\``);
  }
  // A mobile must never reach an author label. The store has only a mobile for a details
  // suggestion, and the mock reads it as "A resident" rather than forwarding the number.
  if (typeof p.authorName === 'string' && /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/.test(p.authorName)) {
    failures.push(`${what} put a mobile number in \`authorName\` — the queue is read by operators, but the same field is the author's own pending banner`);
  }
}

function assertFlatArray(rows, what) {
  if (Array.isArray(rows)) return;
  failures.push(`${what} answered ${rows && typeof rows === 'object' ? `an object with keys ${Object.keys(rows).join(',')}` : JSON.stringify(rows)} — the console counts and groups over the whole set, so a page envelope on one provider is a \`.filter is not a function\` on exactly one build`);
}

/** Oldest first: the work-queue ordering, and the one a newest-first default silently inverts. */
function assertOldestFirst(rows, what) {
  if (!Array.isArray(rows)) return;
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i - 1].createdAt || '') > String(rows[i].createdAt || '')) {
      failures.push(`${what} is not oldest-first — the row somebody has waited longest on ends up buried under this morning's`);
      return;
    }
  }
}

function compareKeys(a, b, what) {
  if (!a || !b) return;
  const onlyMock = Object.keys(a).filter((k) => !(k in b));
  const onlyLive = Object.keys(b).filter((k) => !(k in a));
  if (onlyMock.length) failures.push(`${what} has ${onlyMock.join(', ')} on the mock and not live — a column that renders on one build and reads \`undefined\` on the other`);
  if (onlyLive.length) failures.push(`${what} has ${onlyLive.join(', ')} live and not on the mock`);
}

/**
 * Types, for the fields both sides answered non-null.
 *
 * Null-vs-value is not drift: the mock has no `decidedByName` for a pending row and neither does
 * the server, and a details proposal carries no `lat`. What would be drift is one side answering a
 * number where the other answers a string — `buildYear` as `"2011"` sorts and formats differently
 * from `2011`, and nothing about the call site says which it got.
 */
function compareTypes(a, b, what) {
  if (!a || !b) return;
  for (const k of Object.keys(a)) {
    if (!(k in b) || a[k] === null || b[k] === null) continue;
    const ta = Array.isArray(a[k]) ? 'array' : typeof a[k];
    const tb = Array.isArray(b[k]) ? 'array' : typeof b[k];
    if (ta !== tb) failures.push(`${what} answers \`${k}\` as ${ta} on the mock and ${tb} live`);
  }
}

/**
 * Walk a live queue until the row turns up.
 *
 * Both queues are oldest-first and paged, so a row filed a second ago is on the *last* page.
 * Reading page 0 and concluding the queue cannot see it would report a fixture collision as drift.
 *
 * Stopping on a short page rather than on an empty one is not a micro-optimisation: the provider
 * asks for `MAX_PAGE_SIZE` and hands the envelope to `unwrapFullPage`, which warns when
 * `totalElements` exceeds the rows returned. Reading one page past the end trips that warning with
 * "1 rows exist but only 0 were fetched" — a truncation notice, printed by a harness that caused
 * it, in a log somebody would reasonably read as a finding.
 */
async function findInQueue(listFn, opts, match) {
  for (let page = 0; page < 25; page += 1) {
    const rows = await listFn({ ...opts, page });
    if (!Array.isArray(rows) || !rows.length) return null;
    const hit = rows.find(match);
    if (hit) return hit;
    if (rows.length < MAX_PAGE_SIZE) return null;
  }
  return null;
}

/** The HTTP status a refusal carried, or `null` when the call unexpectedly succeeded. */
async function statusOfRejection(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err?.status ?? 'an error with no status';
  }
}

/** A declaration, not a `const` arrow: the callers above run before this line is reached. */
function describeStatus(s) {
  return s === null ? '200 (it succeeded)' : String(s);
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
 * rather than taking a token argument, so switching identity means rewriting storage. The mock
 * reads `puneNestUser` for the same purpose, which is why both keys are written together — a
 * harness that changed only one would have the two providers acting as two different people.
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
  console.log('\n  PASS — mock and live society providers agree on every field the ops queues rely on.\n');
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
