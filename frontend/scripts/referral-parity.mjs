/**
 * Contract-parity check: mock referral provider vs the live API.
 *
 * This domain is the awkward one, and pretending otherwise is how a harness becomes decoration.
 * `referralService.js` has seven exports, and the two providers behind it agree on the *shape* of
 * three of them, diverge deliberately on a fourth, and deliberately do not implement three more.
 * None of that is drift; all of it is written down, in `mock/referralProvider.js`'s header and in
 * D184. So this script does two different jobs and says which is which at every assertion:
 *
 *  - Where the two builds are supposed to agree — the seam surface, the summary's five fields and
 *    their types, the queue envelope, the vocabularies, the masking — it compares them.
 *  - Where they are supposed to differ, it asserts **the documented contract on each side
 *    separately**. Forcing those to agree would mean changing a provider to match a harness, which
 *    is the tail wagging the dog; leaving them unasserted would mean the documented behaviour could
 *    rot with nothing noticing, which is the state this domain was already in.
 *
 * ## The three deliberate divergences, and what is checked instead
 *
 * 1. **`redeemReferral` credits nobody on the mock.** It writes `pnReferredBy:<mobile>` and returns.
 *    Live, it creates a referral row the fraud desk can see and the referrer's `invited` moves.
 *    Checked: mock records the attribution locally and moves no counter; live creates a row, moves
 *    `invited`, and refuses an unknown code, a self-referral and a second redemption with 409.
 *    Both resolve nullish — the server's `redeem` returns `void`, so a 200 with an empty body is
 *    `null` through `http.js` too. The divergence is in the *effect*, not the shape, and the
 *    docblock's "resolves the server's 200 body" reads as more than it is.
 * 2. **`shareChannel` is dropped on the mock**, hence its one-argument signature. Checked: passing
 *    it is harmless on the mock, and lands on the desk row live.
 * 3. **The fraud desk has no mock provider.** The four desk functions exist as throwing stubs so
 *    the failure names its reason rather than reading `is not a function`. Checked: they exist, they
 *    reject, and the message still names the escape hatch (`VITE_API_DOMAINS`) — a stub whose
 *    message rots is worse than a missing export, because it is confidently wrong.
 *
 * And one that is not a divergence at all: **the codes are different by design.** The mock mints
 * `RAHU0011` from a name and a mobile; the server mints `PUNE-AB12` from `referral_codes` (V23).
 * They are not meant to match — a mock build has no server to agree with, and only the server's is
 * resolvable by `POST /referrals/redeem`. What *is* checked is that each side still produces its own
 * documented format, because the failure this replaced was a page reading the server's code and
 * sharing a link built from the browser's: exactly half right, with nothing at the call site to say
 * so.
 *
 * `referralLink` is asserted once, not twice, and that is the point of it: it is the one export in
 * `referralService.js` that is **not** a provider call, because the link is the same string on both
 * builds and two implementations of `origin + '/signup?ref='` kept in step by hand is how it grew
 * a default argument that silently built links around the unresolvable code.
 *
 * Usage (backend must be running):
 *   node scripts/referral-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/referral-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
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
/** The referrer: whose code is shared, and whose `invited` must move when it is used. */
const MOBILE = args.get('mobile') || `98762${String(Date.now()).slice(-5)}`;
/**
 * The referee, and necessarily a second identity.
 *
 * `existsByReferredMobile` makes redemption once-per-mobile forever, so a harness that reused one
 * account would pass on a fresh database and 409 on every run after — reporting its own fixture as
 * a contract break.
 */
const REFEREE = args.get('referee') || `98761${String(Date.now()).slice(-5)}`;
/** The fraud desk is `STAFF_OR_ADMIN`; the seeded platform admin is the account this can rely on. */
const OPS_MOBILE = args.get('ops') || '9000000000';

/** `ReferralStatuses` / the mapper's fallbacks — note there is no `flagged`, which is the point. */
const STATUSES = ['pending', 'qualified', 'rewarded', 'rejected', 'clawed-back'];
const RISKS = ['low', 'medium', 'high'];

/** The five scalars of `ReferralSummaryDto`, which the mock answers field-for-field. */
const SUMMARY_FIELDS = ['code', 'invited', 'converted', 'contactsEarned', 'contactsPending'];

/** The desk row `referralMapper.toViewModel` builds; the board renders every one of these. */
const ROW_FIELDS = [
  'id', 'referrer', 'referrerMobile', 'referred', 'referredMobile', 'channel', 'shareChannel',
  'reward', 'rewardAmount', 'status', 'risk', 'aadhaarVerified', 'aadhaarUnique', 'sameDevice',
  'sameIp', 'velocityHigh', 'activated', 'at', 'qualifiedAt', 'handledBy', 'handledAt',
];

/** A bare Indian mobile. If one of these survives to a desk row, the masking has stopped working. */
const BARE_MOBILE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/;

/**
 * Refuse a `--base` that is not loopback.
 *
 * This harness signs in as the seeded platform admin to read the fraud desk, and it redeems
 * referrals — writes that move a real referrer's counters and are once-per-mobile *forever*
 * (`existsByReferredMobile`), so they cannot be undone by running it again. Aimed at a shared or
 * production API by a mistyped or copy-pasted `--base`, the rows exist before the run reports
 * anything. Nothing in this file stood in the way until now: the only obstacles were backend-side
 * (a dev-only seeded admin, a dev-only mock OTP sender), and a script may not assume the
 * environment it was pointed at shares them.
 *
 * The host test itself lives in `lib-assert-local-base.mjs`, shared with the runner and the other
 * nineteen harnesses — see there for why it parses rather than substring-matches.
 */
assertLoopbackBase(
  BASE,
  args.has('i-know-what-im-doing'),
  'This harness signs in as a platform admin and redeems referrals, which is an irreversible'
  + '\n  write, so it may only run against a backend on this machine.',
);

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  live API: ${BASE}`);

const referrer = await signIn(MOBILE);
const referee = await signIn(REFEREE);
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

useSession(referrer);

const mock = await load('../src/services/providers/mock/referralProvider.js');
// The mock reads a seed that is fetched asynchronously, and every read throws until it lands — in
// the browser `main.jsx` awaits this before rendering, and a script has to do the same.
await (await load('../src/lib/mockApi.js')).ensureMockDb();
const live = await load('../src/services/providers/http/referralProvider.js');
const store = await load('../src/lib/store/referrals.js');
const service = await load('../src/services/referralService.js');

// ─── The seam itself ──────────────────────────────────────────────────────────────────────────
// The four desk functions are throwing stubs on the mock, and that is *why* the surfaces must
// match: `OpsReferrals` gates on `isHttpDomain('referral')`, so the export existing is what turns a
// mis-set flag into a sentence explaining the domain is shut rather than a TypeError.
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')} — a desk function absent rather than throwing reads as "is not a function", which names the mechanism and not the reason`);

// Every export `referralService.js` reaches for must be on both providers, whatever it does there.
for (const op of ['listReferralQueue', 'approveReferral', 'rejectReferral', 'clawbackReferral', 'getMyReferralSummary', 'redeemReferral']) {
  if (typeof live[op] !== 'function') failures.push(`http provider must export \`${op}\``);
  if (typeof mock[op] !== 'function') failures.push(`mock provider must export \`${op}\``);
}

// `referralLink` is service-level on purpose. If it ever appears on a provider, the seam has grown
// two implementations of one string and the default-argument bug has a place to come back to.
for (const [m, what] of [[mock, 'mock'], [live, 'http']]) {
  if (typeof m.referralLink === 'function') {
    failures.push(`the ${what} provider exports \`referralLink\` — it belongs to \`referralService.js\` because the link is the same string on both builds; two copies is how it grew a default argument that built links around a code the server cannot resolve`);
  }
}

// ─── The summary: the half both builds genuinely answer ───────────────────────────────────────
const mockSummary = await mock.getMyReferralSummary();
const liveSummaryBefore = await live.getMyReferralSummary();

compareKeys(mockSummary, liveSummaryBefore, 'the referral summary');
for (const [s, what] of [[mockSummary, 'the mock summary'], [liveSummaryBefore, 'the live summary']]) {
  for (const f of SUMMARY_FIELDS) {
    if (!(f in s)) failures.push(`${what} is missing \`${f}\` — Refer.jsx renders all five, and an absent count draws as blank rather than as zero`);
  }
  if (typeof s.code !== 'string' || !s.code.trim()) {
    failures.push(`${what} has no \`code\` — it is the whole content of the share sheet`);
  }
  for (const f of ['invited', 'converted', 'contactsEarned', 'contactsPending']) {
    if (typeof s[f] !== 'number' || Number.isNaN(s[f])) {
      failures.push(`${what} answers \`${f}\` as ${JSON.stringify(s[f])} — the page adds these, and a string concatenates where a number sums`);
    }
  }
}

// Each side's own documented code format. Deliberately different (see the header); asserted so that
// neither quietly starts minting the other's, which is the failure that made every share link dead.
if (!/^PUNE-[A-HJ-NP-Z2-9]{4}$/.test(liveSummaryBefore.code)) {
  failures.push(`the live code ${JSON.stringify(liveSummaryBefore.code)} is not PUNE-XXXX over the dictation-safe alphabet (no I, O, 0, 1) — these are read off phone screens, and a referrer whose reward hinges on someone typing 0 for O loses it`);
}
if (/^PUNE-/.test(mockSummary.code)) {
  failures.push(`the mock is minting a server-shaped code (${JSON.stringify(mockSummary.code)}) — it is left visibly its own so a reader can tell which build produced a code, and because \`POST /referrals/redeem\` cannot resolve this one whatever it looks like`);
}

// Rewards are reported as zero rather than omitted: the mock has no redemption and no desk, so no
// referral here has ever been approved. Zero keeps the shape; omitting would break the seam.
if (mockSummary.contactsEarned !== 0 || mockSummary.contactsPending !== 0) {
  failures.push(`the mock reported contactsEarned=${mockSummary.contactsEarned}, contactsPending=${mockSummary.contactsPending} — there is nothing on this build that can approve a referral, so anything but 0 is a number no action can justify`);
}

// ─── Redemption, mock side: records the attribution, credits nobody, never 409s ───────────────
const mockCode = 'PARITY-PROBE';
const mockRedeem = await mock.redeemReferral(mockCode, 'whatsapp');
if (mockRedeem != null) {
  failures.push(`mock redeemReferral resolved ${JSON.stringify(mockRedeem)}; it has nothing to answer with and the callers treat nullish as "recorded"`);
}
if (store.getReferredBy() !== mockCode) {
  failures.push(`mock redeemReferral did not record the attribution (\`pnReferredBy\` is ${JSON.stringify(store.getReferredBy())}) — this write is the mock build's entire answer to attribution, and it lives below the seam so a live build does not also perform it`);
}
// No 409, by design: unknown, self-referred and already-redeemed are all recorded happily, because
// none of those facts exist locally to check against. Asserted so the mock does not grow a *fake*
// conflict — which is precisely the defect that went unnoticed in the society mock.
const mockSecond = await mock.redeemReferral(mockCode).then(() => null, (e) => e);
if (mockSecond) {
  failures.push(`mock redeemReferral threw on a second redemption (${describeError(mockSecond)}) — it has no referral table to find a duplicate in, so a conflict here would be invented rather than observed`);
}
// And it credits nobody. `setReferredBy` never touched the referrer's counters: cross-device
// attribution needs a real backend, which is the sentence this assertion is protecting.
const mockSummaryAfter = await mock.getMyReferralSummary();
if (mockSummaryAfter.invited !== mockSummary.invited || mockSummaryAfter.converted !== mockSummary.converted) {
  failures.push('mock redeemReferral moved the referrer\'s counters — nothing local can credit a referrer, and a number that moves on redemption is a reward the build cannot pay');
}

// ─── Redemption, live side: refusals first, so nothing here consumes the referee ──────────────
// Every refusal is the same 409 with the same message on purpose: distinct answers would turn this
// endpoint into an oracle for "is PUNE-XXXX a real code?", the reconnaissance step before farming
// one. So this checks the code and does not read the message.
const unknown = await statusOfRejection(() => live.redeemReferral('PUNE-ZZZZ', 'whatsapp'));
if (unknown !== 409) failures.push(`live redeemReferral answered ${describeStatus(unknown)} for an unknown code, expected 409`);

const own = await statusOfRejection(() => live.redeemReferral(liveSummaryBefore.code, 'whatsapp'));
if (own !== 409) failures.push(`live redeemReferral answered ${describeStatus(own)} for the caller's own code, expected 409 — self-referral is the cheapest way to mint a reward`);

// The real one, as the referee. `shareChannel` is passed because the second argument is the half of
// the signature the mock drops, and an argument nothing ever sends is an argument nothing tests.
useSession(referee);
const liveRedeem = await live.redeemReferral(liveSummaryBefore.code, 'whatsapp');
if (liveRedeem != null) {
  warnings.push(`live redeemReferral resolved ${JSON.stringify(liveRedeem)}; the endpoint returns void, so nullish is expected and this shape is new`);
}
const repeat = await statusOfRejection(() => live.redeemReferral(liveSummaryBefore.code, 'whatsapp'));
if (repeat !== 409) {
  failures.push(`live redeemReferral answered ${describeStatus(repeat)} to a second redemption by the same account, expected 409 — one referral per referred mobile is the constraint the whole reward budget rests on`);
}

// The counter the referrer is shown must move, and this is the assertion that distinguishes the
// live half from the mock's: `invited` means "people who redeemed" server-side, not "shares".
useSession(referrer);
const liveSummaryAfter = await live.getMyReferralSummary();
if (liveSummaryAfter.invited !== liveSummaryBefore.invited + 1) {
  failures.push(`the referrer's \`invited\` went ${liveSummaryBefore.invited} → ${liveSummaryAfter.invited} after a redemption, expected +1 — the page tells them "You've invited N", and a number that does not move is the reward program looking broken to the person promoting it`);
}
if (liveSummaryAfter.code !== liveSummaryBefore.code) {
  failures.push(`the referrer's code changed (${liveSummaryBefore.code} → ${liveSummaryAfter.code}) — one code per user forever, because rotating it breaks every card and forwarded message already carrying the old one`);
}

// ─── The fraud desk: absent on the mock, and absent loudly ────────────────────────────────────
for (const op of ['listReferralQueue', 'approveReferral', 'rejectReferral', 'clawbackReferral']) {
  const err = await Promise.resolve()
    .then(() => mock[op]('any-id', 'any-reason'))
    .then(() => null, (e) => e);
  if (!err) {
    failures.push(`mock ${op} resolved — it must throw. The mock store's referral vocabulary disagrees with the server's about what a referral is (a \`flagged\` status the server has no concept of, unmasked mobiles it withholds, a perk where it pays rupees), and something plausible-looking here is a fraud desk reviewing fiction`);
    continue;
  }
  // The message is load-bearing: it is what an operator sees, and it has to name the way out.
  if (!/VITE_API_DOMAINS/.test(String(err.message))) {
    failures.push(`mock ${op} threw without naming \`VITE_API_DOMAINS\` (${describeError(err)}) — the stub exists instead of a missing export precisely so the failure states the reason and the remedy`);
  }
}

// A consumer must never reach the live queue. Through the raw API, because the provider would throw
// either way and the distinction that matters is 403-not-200: unmasked-adjacent fraud signals about
// other people's referrals are exactly what `STAFF_OR_ADMIN` is on this route for.
const asMember = await api('GET', '/referrals', null, referrer.token);
if (asMember.status !== 403) {
  failures.push(`GET /referrals answered ${asMember.status} to an ordinary member, expected 403`);
}

// ─── The live desk, as the operator ───────────────────────────────────────────────────────────
useSession(ops);

const page = await live.listReferralQueue({ page: 0, size: 20 });
for (const f of ['items', 'total', 'page', 'size']) {
  if (!(f in page)) failures.push(`the live queue envelope is missing \`${f}\` — the stat tiles read \`total\`, and they must be true on page 1 of 3`);
}
if (!Array.isArray(page.items)) failures.push('the live queue answered a non-array `items`');
if (typeof page.total !== 'number') failures.push('the live queue answered a non-numeric `total`');
if (page.total < page.items.length) {
  failures.push(`the live queue reports total=${page.total} under ${page.items.length} rows — \`total\` is the envelope's \`totalElements\`, not this page's length`);
}

// The referral just created must be visible to the desk. Newest first here, unlike the society ops
// queues: a fraud desk reads the most recent signups, so page 0 is where a fresh row belongs.
const deskRow = page.items.find((r) => r.referrer && r.status === 'pending' && r.shareChannel === 'whatsapp')
  || page.items[0];
if (!page.items.length) {
  failures.push('the live queue came back empty immediately after a redemption created a referral — a fraud desk shown nothing is indistinguishable from one shown nothing suspicious');
}

for (const row of page.items) {
  for (const f of ROW_FIELDS) {
    if (!(f in row)) {
      failures.push(`a desk row is missing \`${f}\` — every one of these is a column or a chip on the board`);
      break;
    }
  }
  if (!STATUSES.includes(row.status)) {
    failures.push(`a desk row has status ${JSON.stringify(row.status)}, outside ${STATUSES.join('|')} — there is no \`flagged\`; risk is a separate field, which is what that tab was reaching for`);
  }
  if (!RISKS.includes(row.risk)) {
    failures.push(`a desk row has risk ${JSON.stringify(row.risk)}, outside ${RISKS.join('|')}`);
  }
  // Both mobiles are masked and stay masked: the platform's rule for a privileged *list* is that it
  // is masked, and the contract declares no audited single-record unmasked read for referrals. The
  // desk's job is served by the signals instead — the checker sees the finding, not the evidence.
  for (const f of ['referrerMobile', 'referredMobile']) {
    if (BARE_MOBILE.test(String(row[f] || ''))) {
      failures.push(`a desk row carried an unmasked \`${f}\` — this is the field whose removal retired the mock's \`creditReferrer({ mobile })\`, and putting it back hands every operator a phone book`);
    }
  }
  // `at` and the two decision stamps are epoch millis, not ISO: the board sorts on them.
  for (const f of ['at', 'qualifiedAt', 'handledAt', 'rewardAmount']) {
    if (typeof row[f] !== 'number') {
      failures.push(`a desk row answers \`${f}\` as ${typeof row[f]} — the board sorts and sums on these, and a string sorts lexically`);
    }
  }
  for (const f of ['aadhaarVerified', 'aadhaarUnique', 'sameDevice', 'sameIp', 'velocityHigh', 'activated']) {
    if (typeof row[f] !== 'boolean') {
      failures.push(`a desk row answers the signal \`${f}\` as ${typeof row[f]} — the chips render a finding, and only a boolean can mean "no evidence" rather than "unknown"`);
    }
  }
}

// The channel the referee sent is the statistic the mock drops. Warn rather than fail if the row
// this run created has scrolled off page 0 — a busy queue is not drift.
if (deskRow && deskRow.shareChannel !== 'whatsapp') {
  warnings.push('the referral created by this run was not on page 0 of the desk queue, so `shareChannel` round-tripping was not observed — the queue is busy, not wrong');
}

// ─── `referralLink`: one implementation, and a blank code is not a link ───────────────────────
const link = service.referralLink(liveSummaryAfter.code);
if (link !== `${globalThis.location.origin}/signup?ref=${encodeURIComponent(liveSummaryAfter.code)}`) {
  failures.push(`referralLink built ${JSON.stringify(link)} — the share sheet's entire payload, and the only code a caller holds is the one the summary just returned`);
}
if (service.referralLink('') !== '' || service.referralLink(null) !== '' || service.referralLink('   ') !== '') {
  failures.push('referralLink answered a link for a blank code — a Copy button that reports success over a dead link is worse than one with nothing to copy');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function compareKeys(a, b, what) {
  if (!a || !b) return;
  const onlyMock = Object.keys(a).filter((k) => !(k in b));
  const onlyLive = Object.keys(b).filter((k) => !(k in a));
  if (onlyMock.length) failures.push(`${what} has ${onlyMock.join(', ')} on the mock and not live — a field that renders on one build and reads \`undefined\` on the other`);
  if (onlyLive.length) failures.push(`${what} has ${onlyLive.join(', ')} live and not on the mock`);
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

function describeError(err) {
  return err?.message ? String(err.message).slice(0, 120) : String(err);
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
 * reads `puneNestUser` for the same purpose — and here it matters twice over, because
 * `referralCode()` and `pnReferredBy:<mobile>` are both keyed off the mobile in that record.
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
  console.log('\n  PASS — mock and live referral providers agree where they claim to, and diverge only where they document it.\n');
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
