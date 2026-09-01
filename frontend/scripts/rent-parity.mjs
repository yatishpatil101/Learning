/**
 * Rent parity — mock vs live for the money domain.
 *
 * Run with the backend up:
 *
 *   node scripts/rent-parity.mjs --base http://localhost:8081/api --otp-log <backend log>
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * ## Getting a tenancy to test against
 *
 * A tenancy is not something the API creates directly — it is a *consequence*. Closing a **rent**
 * deal opens one, in the same transaction (backend D1), because a rented flat with no tenancy would
 * leave the owner unable to collect rent and the tenant with no agreement to point at.
 *
 * So this harness signs in as two people, has the owner list a rent property, and closes the deal
 * against the tenant. That is the only honest way to arrive at a tenancy, and it doubles as a check
 * that the deal → tenancy bridge still works.
 *
 * ## What is asserted
 *
 *   1. **Surface parity** — every function the service calls exists on both providers.
 *   2. **The fee is the same on both sides** — the client quotes `round(amount × pct / 100)` before
 *      paying and the server charges its own; they must agree to the rupee or a tenant is shown one
 *      total and billed another (the D108 shape, in rent).
 *   3. **Paying yields `due`, not `paid`** — the entitlement question of this domain.
 *   4. **A second payment in the same month is refused** — 409, or two taps become two charges.
 *   5. **A stale `expectedAmount` is refused** — 409, optimistic concurrency on money.
 *   6. **The payout account never returns the account number** — a mask, or nothing.
 *   7. **Scoping** — the tenant's ledger is not the owner's, and neither leaks the other's.
 *
 * Exit code 0 = the two agree, 1 = drift (suitable for CI).
 */
import { assertLoopbackBase } from './lib-assert-local-base.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const stamp = String(Date.now()).slice(-5);
const OWNER_MOBILE = args.get('owner') || `95${stamp}${stamp.slice(0, 3)}`.slice(0, 10);
const TENANT_MOBILE = args.get('tenant') || `94${stamp}${stamp.slice(0, 3)}`.slice(0, 10);
const RENT = 25000;

/** Refuse a `--base` that is not loopback — the shared test lives in `lib-assert-local-base.mjs`. */
assertLoopbackBase(
  BASE,
  args.has('i-know-what-im-doing'),
  'This harness signs in as two identities and writes rent-ledger and payout-account rows — money'
  + '\n  records — so it may only run against a backend on this machine.',
);

installStorageStubs();

const failures = [];
const warnings = [];

/* Render an `ApiError` for a human. It carries `code`/`message`/`status`, never a `body` — printing
   `JSON.stringify(e.body)` yields the literal `undefined` and discards the server's reason. */
const describe = (e) => [e?.status, e?.code, e?.message].filter(Boolean).join(' ') || String(e);

console.log(`\n  live API: ${BASE}`);
console.log(`  owner: ${OWNER_MOBILE}   tenant: ${TENANT_MOBILE}`);

const ownerSession = await signIn(OWNER_MOBILE);
const tenantSession = await signIn(TENANT_MOBILE);

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
// Never a bare `await import()`: `mockApi/core` pulls in `db.json` (Node >= 22 needs an import
// attribute) and `persist.js` reads `import.meta.env.DEV`, neither of which resolves outside a
// bundler.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

function become(session) {
  globalThis.localStorage.setItem('puneNestUser', JSON.stringify({
    id: session.userId, name: session.name, mobile: session.mobile, role: 'owner',
  }));
  globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
    accessToken: session.token, refreshToken: session.refreshToken,
  }));
}

become(ownerSession);

const mock = await load('../src/services/providers/mock/rentProvider.js');
const live = await load('../src/services/providers/http/rentProvider.js');
const mapper = await load('../src/services/providers/http/rentMapper.js');

// ─── 1. Surface parity ────────────────────────────────────────────────────────────────────────
// `mockSettleRentPayment` is deliberately mock-only: it stands in for the payment webhook, and an
// http counterpart would be a client that can mark its own rent paid.
const MOCK_ONLY = ['mockSettleRentPayment'];
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k) && !MOCK_ONLY.includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── Set the stage: a rent listing, closed against the tenant, which opens a tenancy ──────────
const listing = await createRentListing(ownerSession);
if (!listing) {
  console.error('\n  Could not create a rent listing — every assertion below would be vacuous.\n');
  report(true);
}
const closed = await api('POST', `/me/deals/${listing}/close`,
  { agreedPrice: RENT, counterpartyMobile: TENANT_MOBILE, note: 'rent parity probe' },
  ownerSession.token);
if (closed.status >= 400) {
  console.error(`\n  Could not close the rent deal (HTTP ${closed.status}): ${JSON.stringify(closed.body)}\n`);
  report(true);
}
console.log(`  listing: ${listing}  (closed \u2192 tenancy)`);

// ─── 7. Scoping: the tenancy shows up on the right side for each party ────────────────────────
become(tenantSession);
const tenantTenancies = await live.myTenancies();
const tenancy = tenantTenancies.find((t) => t.propId === listing);
if (!tenancy) {
  failures.push('closing a rent deal did not open a tenancy visible to the tenant at GET /me/tenancies — the deal\u2192tenancy bridge (D1) is broken, and the rest of this domain hangs off it');
  report(true);
}
for (const [field, type] of Object.entries({ id: 'string', propId: 'string', rent: 'number', status: 'string' })) {
  if (typeof tenancy[field] !== type) failures.push(`live tenancy.${field} is ${typeof tenancy[field]}, expected ${type}`);
}
if (tenancy.rent !== RENT) {
  failures.push(`the tenancy's rent is ${tenancy.rent}, expected the agreed ${RENT} — the figure the tenant is billed comes from here`);
}
// The tenant is not an owner of anything, so their owner-side view must be empty of this row.
const tenantAsOwner = await live.ownerTenancies();
if (tenantAsOwner.some((t) => t.propId === listing)) {
  failures.push('the tenant\'s GET /tenancies contains the owner\'s tenancy — the two directions are supposed to be scoped by role');
}

become(ownerSession);
const ownerSide = await live.ownerTenancies();
if (!ownerSide.some((t) => t.propId === listing)) {
  failures.push('the owner\'s GET /tenancies does not contain the tenancy on their own listing');
}

// ─── 2. The quoted fee and the charged fee must agree ─────────────────────────────────────────
// The client shows a total before the tenant commits (there is no quote endpoint), and the server
// charges its own. If those drift, somebody is shown one number and billed another.
become(tenantSession);
const quote = mapper.quoteRentFee(RENT, { rentPayPercent: 2, gstPercent: 18 });

// ─── 5. A stale expected amount is refused before anything else ───────────────────────────────
const stale = await live.payRent({ tenancyId: tenancy.id, expectedAmount: RENT - 1, method: 'upi' })
  .then(() => 'allowed').catch((e) => e.status);
if (stale !== 409) {
  failures.push(`paying with a stale expectedAmount returned ${stale}, expected 409 — this is optimistic concurrency on money, and the whole reason the field is sent`);
}

// ─── 3. Paying yields `due`, not `paid` ───────────────────────────────────────────────────────
const payment = await live.payRent({ tenancyId: tenancy.id, expectedAmount: RENT, method: 'upi' })
  .catch((e) => { failures.push(`payRent failed: ${describe(e)}`); return null; });

if (payment) {
  if (payment.settled || payment.status === 'paid') {
    failures.push('a fresh rent payment came back settled — it is opened against a gateway order and only the payment webhook may mark it paid. Treating the POST as settlement tells a tenant their rent is in when it is not');
  }
  if (!mapper.isAwaitingSettlement(payment.status)) {
    warnings.push(`a fresh payment has status "${payment.status}", expected "due"`);
  }
  if (!payment.reference) {
    failures.push('the payment carries no reference — that is the gateway order id the webhook matches on, so a payment without one can never be settled and the tenant sits at "due" having actually been charged');
  }
  // 2. the fee
  if (!mapper.feesAgree(quote, payment)) {
    failures.push(`the quoted fee (\u20b9${quote.fee} + \u20b9${quote.gst} GST) does not match the charged fee (\u20b9${payment.platformFee} + \u20b9${payment.gst}) — the tenant is shown one total and billed another`);
  }
  if (payment.total !== payment.amount + payment.platformFee + payment.gst) {
    failures.push('payment.total is not the sum of its parts');
  }

  // ─── 4. A second payment in the same month is refused ───────────────────────────────────────
  const dupe = await live.payRent({ tenancyId: tenancy.id, expectedAmount: RENT, method: 'upi' })
    .then((p) => (p.id === payment.id ? 'idempotent' : 'allowed')).catch((e) => e.status);
  if (dupe !== 409 && dupe !== 'idempotent') {
    failures.push(`a second payment for the same month returned ${dupe}, expected 409 (or the original row, if the idempotency key matched) — otherwise two taps are two charges`);
  }

  // It must show up on the tenant's own history, and on the owner's ledger.
  const mine = await live.myRentPayments();
  if (!mine.items.some((p) => p.id === payment.id)) {
    failures.push('the payment just made is not in the tenant\'s GET /me/rent-payments');
  }
  // `page`, not Spring's `number` (D106). A fallback would hide a clamp or a redirect.
  if (typeof mine.page !== 'number') {
    failures.push('the paged rent-payments envelope has no numeric `page` — the contract field is `page`, not `number`');
  }
}

// ─── 6. The payout account never returns the account number ───────────────────────────────────
become(ownerSession);
const savedAcct = await live.savePayoutAccount({
  accountHolder: 'Parity Probe', accountNumber: '123456789012', ifsc: 'HDFC0001234', upiId: '',
}).catch((e) => { failures.push(`savePayoutAccount failed: ${describe(e)}`); return null; });

if (savedAcct) {
  if (JSON.stringify(savedAcct).includes('123456789012')) {
    failures.push('the payout account response contains the full account number — the server must never re-serve it, including to its owner');
  }
  if (!savedAcct.maskedAccount) {
    failures.push('the payout account has no maskedAccount, so the owner cannot tell which account they linked');
  }
  if (!savedAcct.configured) {
    failures.push('an account was just saved but `configured` is false — the pay screen gates on this');
  }
}
// A malformed IFSC must be refused rather than stored.
const badIfsc = await live.savePayoutAccount({
  accountHolder: 'Parity Probe', accountNumber: '123456789012', ifsc: 'nonsense',
}).then(() => 'allowed').catch((e) => e.status);
if (badIfsc === 'allowed') {
  failures.push('a malformed IFSC was accepted — rent would settle to an account that does not exist');
}
const mockBadIfsc = await mock.savePayoutAccount({
  accountHolder: 'Parity Probe', accountNumber: '123456789012', ifsc: 'nonsense',
}).then(() => 'allowed').catch((e) => e.status);
if (mockBadIfsc === 'allowed') {
  failures.push('the mock accepted a malformed IFSC the server rejects — a mock more permissive than the server is how a call site ships green and breaks on switch-on');
}

// ─── The mapper's derived fields ──────────────────────────────────────────────────────────────
if (mapper.isSettled('due') || mapper.isSettled('overdue') || mapper.isSettled('failed')) {
  failures.push('isSettled treated an unsettled status as settled — this is the flag the whole domain gates on');
}
if (!mapper.isSettled('paid')) failures.push('isSettled("paid") must be true');
if (!mapper.isAwaitingSettlement('due')) failures.push('isAwaitingSettlement("due") must be true');
// The fee is rounded before GST is taken on it, half-up, in whole rupees. Rounding the other way
// round drifts by a rupee at a time and the two sides stop agreeing.
const q = mapper.quoteRentFee(25000, { rentPayPercent: 2, gstPercent: 18 });
if (q.fee !== 500 || q.gst !== 90 || q.total !== 25590) {
  failures.push(`quoteRentFee(25000) = fee \u20b9${q.fee}, gst \u20b9${q.gst}, total \u20b9${q.total}; expected \u20b9500 / \u20b990 / \u20b925590`);
}
/* A round number cannot tell the two rounding orders apart — at \u20b925,000 the fee is exactly \u20b9500
   either way, so this assertion passed with the order deliberately reversed. \u20b9125 is the smallest
   amount where it shows: fee_raw = \u20b92.50, which rounds to \u20b93 and yields \u20b91 GST, while taking GST on
   the unrounded \u20b92.50 yields \u20b90.

   Kept as a named case rather than folded in, because a green assertion that cannot go red reads
   like coverage and is worse than none. */
const qEdge = mapper.quoteRentFee(125, { rentPayPercent: 2, gstPercent: 18 });
if (qEdge.fee !== 3 || qEdge.gst !== 1) {
  failures.push(`quoteRentFee(125) = fee \u20b9${qEdge.fee}, gst \u20b9${qEdge.gst}; expected \u20b93 / \u20b91 \u2014 GST is charged on the *rounded* fee, and this is the case that tells the two orders apart`);
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

/** A **rent** listing: closing a rent deal is what opens a tenancy (D1). A sale would not. */
async function createRentListing(session) {
  const res = await api('POST', '/me/listings', {
    title: `Rent parity probe ${stamp}`,
    deal: 'rent',
    propertyType: 'flat',
    bhk: 2,
    price: RENT,
    locality: 'Aundh',
    city: 'Pune',
    area: 850,
  }, session.token);
  if (res.status >= 400) {
    console.error(`  Could not create a listing (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
    return null;
  }
  return res.body?.id || null;
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
  // `window = globalThis` gives a window that passes a `typeof` check but has no `location`, which
  // is a worse lie than having no window at all — so give it one matching the base under test.
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
    console.log('  PASS — mock and live rent providers agree, and the server enforces the money rules the UI depends on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} difference(s):`);
  failures.forEach((f) => console.log(`    x ${f}`));
  console.log('');
  process.exit(1);
}
