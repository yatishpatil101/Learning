/**
 * Contract-parity check: mock plan provider vs the live API, through the http mapper.
 *
 * `planService.js` is a seam — the pricing page, the billing panel and the listing paywall are
 * written against one interface and must not care which provider answered. What makes *this*
 * domain worth a harness is that the two sides disagree about the one thing that matters most:
 *
 * 1. **Buying does not grant.** `POST /me/subscription` on a priced plan creates the row `pending`
 *    against a payment-gateway order; only the signature-verified payment webhook moves it to
 *    `active`. The old mock granted instantly. If the mock still did, every call site could be
 *    written against "pay, then you have it" and would break the day this went live — silently,
 *    because the failure is an entitlement that never arrives rather than an error.
 * 2. **A free plan IS active immediately**, because there is no money to wait for. Collapsing the
 *    two cases either way is wrong.
 * 3. **`GET /me/subscription` answers 200 with an empty document, not 404**, for someone who never
 *    subscribed. A mapper that treated that as an error would blank the pricing page for exactly
 *    the visitor it exists to convert.
 * 4. **Plan identity is a UUID on the wire and a slug in the app.** They join on the plan *name*.
 *    A mismatch here silently puts a paying owner on the free tier's listing ceiling.
 * 5. **`isPaidOwner` must never be true while `status` is `pending`.** This is the entitlement
 *    itself: true here means the Feature action unlocks and the paywall lifts.
 *
 * Usage (backend must be running):
 *   node scripts/plan-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/plan-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
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

globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ id: meId, name: 'Parity Probe', mobile: MOBILE, role: 'owner' }));
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token,
  refreshToken: loginRes.body.refreshToken,
}));

const mock = await load('../src/services/providers/mock/planProvider.js');
const live = await load('../src/services/providers/http/planProvider.js');
const mapper = await load('../src/services/providers/http/planMapper.js');

// ─── The seam itself: every operation the service exposes must exist on both ──────────────────
// `mockActivateSubscription` is deliberately mock-only — it stands in for the payment webhook, and
// an http counterpart would be a client that can grant itself a paid plan. So it is excluded rather
// than reported as drift.
const MOCK_ONLY = ['mockActivateSubscription'];
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k) && !MOCK_ONLY.includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The catalogue ────────────────────────────────────────────────────────────────────────────
const livePlans = await live.listPlans();
const mockPlans = await mock.listPlans();

if (!livePlans.length) {
  failures.push('GET /plans returned nothing — the plan catalogue is not seeded, and every assertion below is vacuous');
}

for (const p of livePlans) {
  if (!p.slug) {
    failures.push(`live plan "${p.name}" mapped to no slug — the app has no pricing card, listing limit or checkout route for it, so a caller on it would silently read as free tier`);
  }
  for (const [field, type] of Object.entries({ id: 'string', name: 'string', audience: 'string', price: 'number', billingCycle: 'string' })) {
    if (typeof p[field] !== type) failures.push(`live plan "${p.name}".${field} is ${typeof p[field]}, expected ${type}`);
  }
  if (!Array.isArray(p.features)) failures.push(`live plan "${p.name}".features must be an array — the pricing card maps over it`);
}

// Both sides must offer the same slugs. Prices legitimately differ (the mock reads the back-office
// Fees panel, which ops can change at runtime; the server's plan row is itself the price), so that
// is a tolerated difference rather than a break.
const liveSlugs = livePlans.map((p) => p.slug).filter(Boolean).sort();
const mockSlugs = mockPlans.map((p) => p.slug).filter(Boolean).sort();
if (liveSlugs.join(',') !== mockSlugs.join(',')) {
  failures.push(`catalogue slugs differ — live [${liveSlugs}] vs mock [${mockSlugs}]. A slug the pricing page routes to but the server does not have is a dead checkout link`);
}
for (const slug of liveSlugs) {
  const l = livePlans.find((p) => p.slug === slug);
  const m = mockPlans.find((p) => p.slug === slug);
  if (m && l.price !== m.price) {
    warnings.push(`price differs for ${slug}: live ₹${l.price} vs mock ₹${m.price} — expected, the mock reads the admin Fees panel`);
  }
}

// ─── The unsubscribed caller ──────────────────────────────────────────────────────────────────
// This probe signed in as a brand-new mobile, so they have no subscription. The server answers 200
// with an empty document rather than 404, and that must resolve to the free tier.
const before = await live.getSubscription();
assertPlanShape(before, 'the unsubscribed caller');
if (before.id !== 'free') {
  failures.push(`a caller with no subscription resolved to plan "${before.id}", expected "free"`);
}
if (before.isPaidOwner) {
  failures.push('a caller with no subscription came back isPaidOwner=true — this unlocks the Feature action and lifts the listing paywall');
}
if (before.listingLimit !== 1) {
  failures.push(`the free tier's listingLimit is ${before.listingLimit}, expected 1 — this is the paywall ceiling`);
}

// ─── Buying a priced plan must NOT grant it ───────────────────────────────────────────────────
const pricedSlug = livePlans.find((p) => p.slug && p.price > 0 && p.audience === 'owner')?.slug;
if (!pricedSlug) {
  failures.push('no priced owner plan in the catalogue — cannot exercise the pending path');
} else {
  const bought = await live.subscribe(pricedSlug, 'upi');
  assertPlanShape(bought, 'the freshly bought plan');

  if (bought.status !== 'pending') {
    failures.push(`buying a priced plan returned status=${JSON.stringify(bought.status)}, expected "pending" — only the payment webhook may activate it`);
  }
  if (bought.isPaidOwner) {
    failures.push('a PENDING subscription reported isPaidOwner=true — this is the entitlement, and it would hand somebody a paid plan for an abandoned checkout');
  }
  if (bought.id !== 'free') {
    failures.push(`a pending subscription reported the held plan as "${bought.id}" — until it is paid for, the caller still holds the free tier`);
  }
  if (bought.pendingSlug !== pricedSlug) {
    failures.push(`pendingSlug is ${JSON.stringify(bought.pendingSlug)}, expected ${JSON.stringify(pricedSlug)} — the checkout screen needs it to name the purchase that is waiting`);
  }
  if (!bought.paymentRef) {
    warnings.push('no paymentRef on the pending subscription — the checkout SDK needs the gateway order id to continue');
  }

  // The mock must agree, or a call site written against it breaks on the day this goes live.
  const mockBought = await mock.subscribe(pricedSlug, 'upi');
  if (mockBought.status !== 'pending') {
    failures.push(`the MOCK granted a priced plan immediately (status=${JSON.stringify(mockBought.status)}). That is the difference this harness exists to catch: a page written against it would ship broken`);
  }
  if (mockBought.isPaidOwner) {
    failures.push('the MOCK reported isPaidOwner=true for a pending purchase');
  }

  // Idempotency: a double-tapped Pay button must not open a second gateway order.
  const again = await live.subscribe(pricedSlug, 'upi');
  if (again.subscriptionId && bought.subscriptionId && again.subscriptionId !== bought.subscriptionId) {
    failures.push('a repeated subscribe created a SECOND subscription — Idempotency-Key is not reaching the server, so a double-tapped Pay button opens two orders');
  }
}

// ─── A free plan IS active immediately ────────────────────────────────────────────────────────
const freeSlug = livePlans.find((p) => p.slug && p.price === 0)?.slug;
if (freeSlug) {
  const free = await live.subscribe(freeSlug, 'upi');
  if (free.status !== 'active') {
    failures.push(`subscribing to a FREE plan returned status=${JSON.stringify(free.status)}, expected "active" — there is no money to wait for`);
  }
} else {
  warnings.push('no zero-priced plan in the catalogue — the free-is-immediate path was not exercised');
}

// ─── Shared shape assertion ───────────────────────────────────────────────────────────────────
function assertPlanShape(vm, label) {
  if (!vm || typeof vm !== 'object') {
    failures.push(`${label}: expected an object, got ${typeof vm}`);
    return;
  }
  for (const [field, type] of Object.entries({ id: 'string', name: 'string', isPaidOwner: 'boolean', listingLimit: 'number' })) {
    if (typeof vm[field] !== type) {
      failures.push(`${label}.${field} is ${typeof vm[field]}, expected ${type} — every consumer reads it unguarded`);
    }
  }
  if (vm.listingLimit < 1) {
    failures.push(`${label}.listingLimit is ${vm.listingLimit} — below the free-tier floor, so nobody could post at all`);
  }
  if (mapper.isEntitled(vm.status) === false && vm.isPaidOwner) {
    failures.push(`${label}: isPaidOwner=true while status=${JSON.stringify(vm.status)} is not active`);
  }
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

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
  // `services/config.js` compares `API_BASE` against the page origin. `window = globalThis` gives a
  // `window` that passes a `typeof` check but has no `location`, which is a worse lie than having no
  // window at all — so give it one, matching the base this run actually targets.
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
    console.log('  PASS — mock and live plan providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
