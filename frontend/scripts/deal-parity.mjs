/**
 * Deal parity — mock vs live for the transaction domain.
 *
 * Run with the backend up:
 *
 *   node scripts/deal-parity.mjs --base http://localhost:8081/api --otp-log <backend log>
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy in
 * front, and the backend serves under `server.servlet.context-path=/api`.
 *
 * ## What this proves, and what it deliberately cannot
 *
 * This domain has two sides that must be different people: an owner who lists and an buyer who
 * offers. So unlike every earlier harness, this one signs in **twice** and drives a real
 * negotiation between two identities. A single-identity probe would be unable to test the one
 * property that matters most here — that the server refuses a buyer the owner's decisions.
 *
 * Six things are asserted, in the order a real deal happens:
 *
 *   1. **Surface parity** — every function the service calls exists on both providers.
 *   2. **Owner-scoping** — the buyer's `/me/deals` and `/me/offers` do not contain the owner's
 *      listing. This is the security property the seam exists to preserve: the mock let any caller
 *      name any owner and read their book.
 *   3. **A buyer may not accept or decline** — 403, not a quiet success. The property page had a
 *      button that did exactly this.
 *   4. **A buyer may counter** — the two-sided action, which is what makes it a negotiation.
 *   5. **One live offer per listing** — a second submit is 409, so "revise" must counter.
 *   6. **Closing validates** — a masked or short mobile is refused rather than stored as identity.
 *
 * Exit code 0 = the two agree, 1 = drift (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';
const stamp = String(Date.now()).slice(-5);
const OWNER_MOBILE = args.get('owner') || `97${stamp}${stamp.slice(0, 3)}`.slice(0, 10);
const BUYER_MOBILE = args.get('buyer') || `96${stamp}${stamp.slice(0, 3)}`.slice(0, 10);

installStorageStubs();

const failures = [];
const warnings = [];

/* Render an `ApiError` for a human. It carries `code`/`message`/`status`, never a `body` — printing
   `JSON.stringify(e.body)` yields the literal `undefined` and discards the server's reason. */
const describe = (e) => [e?.status, e?.code, e?.message].filter(Boolean).join(' ') || String(e);

console.log(`\n  live API: ${BASE}`);
console.log(`  owner: ${OWNER_MOBILE}   buyer: ${BUYER_MOBILE}`);

// ─── Sign in as both parties ──────────────────────────────────────────────────────────────────
const ownerSession = await signIn(OWNER_MOBILE);
const buyerSession = await signIn(BUYER_MOBILE);

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
// Never a bare `await import()`: `mockApi/core` pulls in `db.json` (Node >= 22 needs an import
// attribute) and `persist.js` reads `import.meta.env.DEV`, neither of which resolves outside a
// bundler. The four oldest harnesses could not run at all under Node 26 for exactly this reason.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

/** Put a session into the storage stubs, which is where `services/http.js` reads the bearer from. */
function become(session) {
  globalThis.localStorage.setItem('puneNestUser', JSON.stringify({
    id: session.userId, name: session.name, mobile: session.mobile, role: 'owner',
  }));
  globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
    accessToken: session.token, refreshToken: session.refreshToken,
  }));
}

become(ownerSession);

const mock = await load('../src/services/providers/mock/dealProvider.js');
const live = await load('../src/services/providers/http/dealProvider.js');
const mapper = await load('../src/services/providers/http/dealMapper.js');

// ─── 1. Surface parity ────────────────────────────────────────────────────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── Set the stage: the owner needs a listing for anyone to transact on ───────────────────────
const listing = await createListing(ownerSession);
if (!listing) {
  console.error('\n  Could not create a listing to negotiate on — every assertion below would be vacuous.\n');
  report(true);
}
console.log(`  listing: ${listing}`);

// ─── 2. Owner-scoping: the buyer must not see the owner's book ────────────────────────────────
become(buyerSession);
const buyerDeals = await live.myDeals();
if (buyerDeals.some((d) => d.propId === listing)) {
  failures.push('the buyer\'s /me/deals contains the owner\'s listing — /me/deals is supposed to be scoped to listings the caller owns');
}
const buyerGetDeal = await live.getDeal(listing).then(() => 'resolved').catch((e) => e.status);
if (buyerGetDeal === 'resolved') {
  failures.push('a non-owner read GET /me/deals/{propId} successfully — deal state is owner-only');
} else if (buyerGetDeal !== 404) {
  failures.push(`a non-owner reading GET /me/deals/{propId} got ${buyerGetDeal}, expected 404 (never 403 — the server must not confirm the listing exists)`);
}

// ─── 4/5. The buyer opens a negotiation ───────────────────────────────────────────────────────
const offer = await live.submitOffer({ propId: listing, amount: 5000000, message: 'parity probe' }).catch((e) => {
  failures.push(`the buyer could not submit an offer: ${e.status} ${e.message}`);
  return null;
});

if (offer) {
  for (const [field, type] of Object.entries({ id: 'string', propId: 'string', amount: 'number', status: 'string', from: 'string' })) {
    if (typeof offer[field] !== type) failures.push(`live offer.${field} is ${typeof offer[field]}, expected ${type}`);
  }
  // `from` on the seam means "who moved last". On the wire `from` is the *author* and never
  // changes, so the http provider derives this from history. Getting it backwards would invert
  // "you countered" and "they countered" on every card.
  if (offer.from !== 'buyer') {
    failures.push(`a freshly submitted offer reports from="${offer.from}", expected "buyer" — the seam's from is the last mover, derived from history`);
  }

  // A second live offer on the same listing must be refused, or "revise my offer" would stack
  // duplicates instead of countering.
  const dupe = await live.submitOffer({ propId: listing, amount: 5100000 }).then(() => 'allowed').catch((e) => e.status);
  if (dupe !== 409) {
    failures.push(`a second live offer on one listing returned ${dupe}, expected 409 — the revise path depends on this being a conflict`);
  }

  // ─── 3. The buyer must not be able to decide their own offer ────────────────────────────────
  // Both providers refuse locally (that is the point of `mayRespond`), so this asks the *server*
  // directly. A local-only guard would pass this harness and still 403 in a browser the day
  // somebody called the endpoint another way.
  const buyerAccept = await api('POST', `/offers/${offer.id}/respond`, { action: 'accept' }, buyerSession.token);
  if (buyerAccept.status !== 403) {
    failures.push(`the buyer accepting their own offer returned ${buyerAccept.status}, expected 403 — otherwise a buyer marks a price agreed with no owner involvement, and the status-driven contact reveal unmasks a mobile the owner never shared`);
  }
  const buyerDecline = await api('POST', `/offers/${offer.id}/respond`, { action: 'decline' }, buyerSession.token);
  if (buyerDecline.status !== 403) {
    failures.push(`the buyer declining their own offer returned ${buyerDecline.status}, expected 403`);
  }
  // And the provider must refuse before spending the round trip.
  const guarded = await live.respondOffer(offer.id, 'accept', null, { isOwner: false }).then(() => null).catch((e) => e);
  if (!guarded) {
    failures.push('http provider allowed a buyer to accept — mayRespond is not being applied');
  }
  const mockGuarded = await mock.respondOffer(offer.id, 'accept', null, { isOwner: false }).then(() => null).catch((e) => e);
  if (!mockGuarded) {
    failures.push('mock provider allowed a buyer to accept — the mock is more permissive than the server, which is how a call site ships green and breaks on switch-on');
  }

  // ─── 4. But the buyer may counter ───────────────────────────────────────────────────────────
  const counter = await api('POST', `/offers/${offer.id}/respond`, { action: 'counter', counterAmount: 5200000 }, buyerSession.token);
  if (counter.status !== 200) {
    failures.push(`the buyer countering returned ${counter.status}, expected 200 — counter is the two-sided action, and the buyer's "agree at" button depends on it`);
  }
}

// ─── The owner's side ─────────────────────────────────────────────────────────────────────────
become(ownerSession);
const onMine = await live.offersOnMine();
if (offer && !onMine.some((o) => o.id === offer.id)) {
  failures.push('the owner\'s /me/offers does not contain the offer just made on their listing');
}
const ownerDeal = await live.getDeal(listing).catch(() => null);
if (!ownerDeal) {
  failures.push('the owner could not read the deal on their own listing');
} else {
  if (ownerDeal.status !== 'active') {
    warnings.push(`the owner's untouched listing reports status "${ownerDeal.status}" rather than "active"`);
  }
  for (const [field, type] of Object.entries({ propId: 'string', deal: 'string', status: 'string' })) {
    if (typeof ownerDeal[field] !== type) failures.push(`live deal.${field} is ${typeof ownerDeal[field]}, expected ${type}`);
  }
}

// The list read, not just the single-row one. `/me/deals` is paged on the wire (D77) while the
// provider hands back a plain array, and the failure mode of getting that translation wrong is an
// empty list rather than an error — the dashboard renders "no deals yet" and nobody sees a stack
// trace. Only a *positive* assertion catches it: the buyer-scoping check above passes vacuously on
// an empty array, which is precisely how the breakage survived its own harness once already.
// `/me/deals` lists *stored* deal rows, and an untouched listing has none: `DealService.myDeals`
// reads the `deals` table, while `getDeal` synthesizes an active deal on the fly when no row is
// there. So the two endpoints legitimately disagree about a listing nobody has acted on yet —
// `getDeal` says active, the list omits it — and the row only becomes real at the first reserve.
//
// This used to be asserted here as a failure, which made it red on every run: it demanded that the
// list contain a deal the server had never been asked to create. The D77 envelope guard it was
// really there for has moved below the reserve, where a stored row genuinely exists and the
// assertion can be positive without inventing state.
const ownerDeals = await live.myDeals();
if (ownerDeals.some((d) => d.propId === listing)) {
  warnings.push('an untouched listing already has a stored deal row — harmless, but it means something created one before the owner acted');
}

// Reserve → parties → the id-based removal the mock used to do by index.
await live.reserveDeal(listing).catch((e) => failures.push(`reserve failed: ${e.status} ${e.message}`));
const afterReserve = await live.getDeal(listing).catch(() => null);
if (afterReserve && afterReserve.status !== 'reserved') {
  failures.push(`after reserve the deal reports "${afterReserve?.status}", expected "reserved"`);
}

/* The list read, not just the single-row one, and deliberately *after* the reserve — that is the
   call that materialises the stored row, so from here the listing must appear.

   `/me/deals` is paged on the wire (D77) while the provider hands back a plain array, and the
   failure mode of getting that translation wrong is an empty list rather than an error: the
   dashboard renders "no deals yet" and nobody sees a stack trace. Only a *positive* assertion
   catches it — the buyer-scoping check above passes vacuously on an empty array, which is precisely
   how that breakage survived its own harness once already. */
const dealsAfterReserve = await live.myDeals();
if (!dealsAfterReserve.some((d) => d.propId === listing)) {
  failures.push('after reserving, the owner\'s /me/deals still does not contain their own listing — if it is also empty, the page envelope is not being unwrapped');
}
const party = await live.addParty(listing, { name: 'Parity Probe Party', mobile: '9876500011', note: 'probe' })
  .catch((e) => { failures.push(`addParty failed: ${e.status} ${e.message}`); return null; });
if (party) {
  if (!party.id) {
    failures.push('addParty returned no id — removal is by id, and an id-less party can only be removed by position, which is not an identity');
  }
  const parties = await live.listParties(listing);
  if (!parties.some((p) => p.id === party.id)) failures.push('the party just added is not in listParties');
  await live.removeParty(listing, party.id).catch((e) => failures.push(`removeParty failed: ${e.status} ${e.message}`));
  const after = await live.listParties(listing);
  if (after.some((p) => p.id === party.id)) failures.push('removeParty did not remove the party');
}

// ─── 6. Closing validates the counterparty ────────────────────────────────────────────────────
// A masked number (98XXXXX210) strips to five digits. The server refuses rather than storing a
// mask as somebody's identity — the exact defect this project already shipped and fixed on the
// client, so it must not be re-openable through this path.
const masked = await api('POST', `/me/deals/${listing}/close`,
  { agreedPrice: 5000000, counterpartyMobile: '98XXXXX210' }, ownerSession.token);
if (masked.status < 400) {
  failures.push(`closing with a masked mobile returned ${masked.status} — a mask must never be persisted as the counterparty's identity`);
}
const noPrice = await api('POST', `/me/deals/${listing}/close`,
  { counterpartyMobile: BUYER_MOBILE }, ownerSession.token);
if (noPrice.status < 400) {
  failures.push(`closing with no agreedPrice returned ${noPrice.status}, expected a validation error`);
}

// The real close, which must then block a reserve.
await live.closeDeal(listing, { agreedPrice: 5200000, counterpartyMobile: BUYER_MOBILE, note: 'parity probe' })
  .catch((e) => failures.push(`close failed: ${describe(e)}`));
const closed = await live.getDeal(listing).catch(() => null);
if (closed && closed.status !== 'closed') {
  failures.push(`after close the deal reports "${closed?.status}", expected "closed"`);
}
const reserveAfterClose = await live.reserveDeal(listing).then(() => 'allowed').catch((e) => e.status);
if (reserveAfterClose !== 409) {
  warnings.push(`reserving a closed deal returned ${reserveAfterClose}, expected 409`);
}

// ─── The mapper's derived fields ──────────────────────────────────────────────────────────────
if (mapper.lastActorOf([]) !== 'buyer') {
  failures.push('lastActorOf([]) must be "buyer" — an offer with no history has only been submitted');
}
if (mapper.lastActorOf([{ by: 'buyer' }, { by: 'owner' }]) !== 'owner') {
  failures.push('lastActorOf must return the LAST entry — reading the first inverts every countered card');
}
if (mapper.mayRespond('accept', false) || mapper.mayRespond('decline', false)) {
  failures.push('mayRespond let a non-owner accept or decline');
}
if (!mapper.mayRespond('counter', false)) {
  failures.push('mayRespond blocked a buyer from countering — counter is the two-sided action');
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

/** Post a listing as the owner, so there is something real to transact on. */
async function createListing(session) {
  const res = await api('POST', '/me/listings', {
    title: `Parity probe listing ${stamp}`,
    deal: 'buy',
    propertyType: 'flat',
    bhk: 2,
    price: 5000000,
    locality: 'Aundh',
    city: 'Pune',
    area: 900,
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
    console.log('  PASS — mock and live deal providers agree, and the server enforces the rules the UI depends on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} difference(s):`);
  failures.forEach((f) => console.log(`    x ${f}`));
  console.log('');
  process.exit(1);
}
