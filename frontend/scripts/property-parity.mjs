/**
 * Contract-parity check: mock property provider vs the live API, through the http mapper.
 *
 * `services/propertyService.js` is a seam — 21 files read property objects without knowing which
 * provider produced them. That only holds if both providers emit the *same shape*. The auth parity
 * script proves that for auth; this does it for the catalogue, where the risk is much higher because
 * the wire shape and the view model genuinely differ (`propertyType` vs `type`, `PageResponse` vs a
 * bare array, an owner object vs three flat fields). Every one of those is a hand-written mapping,
 * and a hand-written mapping is exactly the thing that should not be trusted on assertion alone.
 *
 * It imports the **real** mock provider and the **real** http mapper — not re-implementations — so
 * drift on either side is caught. Web Storage is stubbed in-memory for the mock's `lib/` dependency.
 *
 * Usage (backend must be running against the seeded dev DB):
 *   node scripts/property-parity.mjs
 *   node scripts/property-parity.mjs --base http://localhost:8081/api
 *
 * **The base must include `/api`.** This script talks to the backend directly, with no Vite dev
 * proxy in front of it, and the backend serves everything under `server.servlet.context-path=/api`.
 * A base without the prefix 404s every request — which is the same failure mode as a backend running
 * older code, so check the `live API:` line this prints before believing a drift report.
 *
 * Coverage note: the owner-scoped and mutating operations (`myListings`, `archiveListing`,
 * `restoreListing`) are checked for *existence* on both providers but not driven, because they need
 * a real session and would write to the dev DB. Their behaviour is covered by the backend's own
 * tests and by manual exercise; only their presence in the seam is enforced here. The four
 * moderation decisions are treated the same way, with one addition: each is *called* against a
 * nonexistent id, purely to prove it issues an HTTP request rather than throwing a "not shipped
 * yet" error. That distinction is invisible to a surface check — a stub and an implementation are
 * both functions — and it is exactly what was wrong before this slice.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8080/api';

installStorageStubs();

// The mock provider's dependency chain reaches Vite-only features (`db.json` imports,
// `import.meta.env`). Loading it through Vite's SSR loader rather than bare Node keeps this a test
// of the *actual* module the browser runs, instead of a Node-adapted lookalike — and avoids bending
// product source to suit a script.
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  // Point the real http client at the live backend. Without this `API_BASE` defaults to the relative
  // `/api`, which the browser resolves against the page origin but Node's fetch cannot resolve at all.
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

const mock = await load('../src/services/providers/mock/propertyProvider.js');
const live = await load('../src/services/providers/http/propertyProvider.js');
const { toModerationQuery, toQuery, toViewModel, toViewModelList, unsupportedFilters } =
  await load('../src/services/providers/http/propertyMapper.js');

const failures = [];
const warnings = [];

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
//
// `propertyService.js` forwards blindly — `(await provider()).myListings(...)` is resolved at call
// time — so a method added to one provider and forgotten on the other fails at runtime, on whichever
// page happens to call it, in whichever mode nobody tested. Comparing the exported surfaces catches
// that at build time instead. Checked before anything else because every assertion below assumes it.
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const mockSurface = surfaceOf(mock);
const liveSurface = surfaceOf(live);
const missingOnLive = mockSurface.filter((k) => !liveSurface.includes(k));
const missingOnMock = liveSurface.filter((k) => !mockSurface.includes(k));
if (missingOnLive.length) {
  failures.push(`http provider is missing: ${missingOnLive.join(', ')} — pages using it break in http mode`);
}
if (missingOnMock.length) {
  failures.push(`mock provider is missing: ${missingOnMock.join(', ')} — pages using it break with the backend off`);
}

// ─── Drive both sides ─────────────────────────────────────────────────────────────────────────

const mockList = await mock.listProperties({}, 'newest');
if (!mockList.length) {
  console.error('\n  Mock catalogue is empty — nothing to compare against.\n');
  process.exit(1);
}
// Compare the *union* of keys across the whole dataset, not one sample row. A field set on only
// some listings (`landUse`, `ageYears`, `tenants`, `pets`, …) is invisible to a single-object diff,
// yet the filter pipeline reads every one of them.
const mockCard = union(mockList);
const mockDetail = await mock.getProperty(mockList[0].id);
const mockFeatured = union(await mock.featuredProperties(6));

const livePage = await api(`/properties?size=100&${qs(toQuery({}, 'newest'))}`);
// State the target up front. A backend running older code fails this harness in exactly the same
// shape as a genuine regression, and the only way to tell them apart is knowing which one answered.
console.log(`\n  live API: ${BASE}`);
if (!livePage.body?.content?.length) {
  console.error(`\n  Live catalogue returned no rows (HTTP ${livePage.status}). Is the backend ` +
    'pointed at the seeded dev DB?\n');
  process.exit(1);
}
const liveRows = toViewModelList(livePage.body);
const liveCard = union(liveRows);
const liveDetailRaw = await api(`/properties/${encodeURIComponent(liveRows[0].id)}`);
const liveDetail = toViewModel(liveDetailRaw.body);
const liveFeatured = union(toViewModelList((await api('/properties/featured')).body));

// ─── Envelope + routing invariants ────────────────────────────────────────────────────────────

if (!Array.isArray(toViewModelList(livePage.body))) {
  failures.push('listProperties(): mapper must unwrap PageResponse into a bare array like the mock');
}
if (liveDetailRaw.status !== 200) {
  failures.push(
    `getProperty(): mapped id "${liveCard.id}" did not resolve on the detail path ` +
      `(HTTP ${liveDetailRaw.status}). The id the UI routes on must be addressable.`,
  );
}

// ─── Field-shape diff ─────────────────────────────────────────────────────────────────────────
//
// Values legitimately differ (different datasets). Only the *shape* must agree, and the dangerous
// direction is a field the mock provides that the mapper doesn't, because components read it and
// get `undefined` the moment the switch flips.
//
// REQUIRED: read without a fallback — a gap is a visible break (blank card, NaN, crash).
// OPTIONAL: read as `p.x || default` — a gap degrades gracefully.
const REQUIRED = [
  'id', 'title', 'deal', 'type', 'price', 'locality', 'localitySlug',
  'bhk', 'bhkNum', 'area', 'status', 'image',
  // Drives the availability/construction facet. The filtering itself is now the server's
  // (`PropertySpecs`, on the `construction` column), so a gap here no longer silently empties a
  // result set — but the card still prints it, so a gap is still a visible break.
  'construction',
];
const OPTIONAL = [
  'furnishing', 'lat', 'lng', 'featured', 'ownerVerified', 'ownershipVerified',
  'views', 'enquiries', 'docsCount', 'flagReason', 'archived', 'createdAt', 'gallery',
  // Derived by the mapper from `reraId`; drives the RERA trust chip on cards.
  'rera',
  // On PropertySummary too, so cards keep their amenity chips; `|| []` guards the gap anyway.
  'amenities',
  // Commercial/land enrichment with no wire counterpart yet. All read behind `?.`, `||` or
  // `Array.isArray` guards (chat.js, RentDetails, derivations, useProperty), so their absence
  // thins the detail page rather than breaking it. Verified read-by-read, not assumed.
  'priceStr', 'commercialType', 'shellType', 'washrooms', 'powerBackup', 'fixtures', 'form',
];
const DETAIL_REQUIRED = ['desc', 'amenities', 'owner', 'ownerMobile'];

// Known, deliberate divergences. Listed by name so they stay visible, not silently absorbed.
const WAIVED = [
  // Detail-only on the wire, and verified unread by Card.jsx — cards never show a description or
  // owner identity, which is also the contact-gate behaviour we want.
  'desc', 'owner', 'ownerId', 'ownerMobile',
  // Read as `p.floorPlan || floorPlanFor(p) || DEFAULT` — a synthesised plan is used instead.
  'floorPlan',
];

console.log('');
compare('listProperties() [all rows]', mockCard, liveCard, REQUIRED, OPTIONAL);
compare('getProperty()', mockDetail, liveDetail, [...REQUIRED, ...DETAIL_REQUIRED], OPTIONAL);
compare('featuredProperties() [all rows]', mockFeatured, liveFeatured, REQUIRED, OPTIONAL);

// ─── Type parity ──────────────────────────────────────────────────────────────────────────────
// A field can be present on both sides and still break a component if its *type* changed — this is
// precisely the `bhk` trap: numeric on the wire, a display string in the view model.
typeCheck('listProperties() [all rows]', mockCard, liveCard, [...REQUIRED, ...OPTIONAL]);
typeCheck('getProperty()', mockDetail, liveDetail, DETAIL_REQUIRED);

// The waiver above claims these are detail-only. Assert it rather than trust it: owner identity and
// contact number leaking into list cards would bypass the contact gate, which is the commercial core
// of the product. A parity harness should prove its own waivers, not assume them.
for (const key of ['desc', 'owner', 'ownerId', 'ownerMobile']) {
  if (liveCard[key] !== undefined) {
    failures.push(
      `listProperties().${key}: present on the card payload but waived as detail-only — ` +
        'contact-gate leak, PropertySummary must not carry it',
    );
  }
}

// ─── Semantic spot-checks the type diff can't catch ───────────────────────────────────────────
// Semantic checks use a single real row — a unioned object can mix fields across listings, which
// would make `bhk` and `bhkNum` disagree for reasons that aren't a bug.
const liveRow = liveRows[0];
if (liveRow.bhkNum && liveRow.bhk !== `${liveRow.bhkNum} BHK`) {
  failures.push(`bhk label "${liveRow.bhk}" does not match bhkNum ${liveRow.bhkNum}`);
}
if (liveRow.localitySlug && liveRow.localitySlug !== liveRow.localitySlug.toLowerCase()) {
  failures.push(`localitySlug "${liveRow.localitySlug}" is not lowercase — filters key off it exactly`);
}
// The whole point of localitySlug: the facet must key off it, not the display name.
const bySlug = await api(`/properties?locality=${encodeURIComponent(liveRow.localitySlug)}`);
if (!(bySlug.body?.totalElements > 0)) {
  failures.push(`locality facet returned nothing for slug "${liveRow.localitySlug}"`);
}
const byName = await api(`/properties?locality=${encodeURIComponent(liveRow.locality)}`);
if (byName.body?.totalElements > 0 && liveRow.locality !== liveRow.localitySlug) {
  warnings.push('locality facet also matches the display name — the slug may not be the real key');
}

// The possession facet, end-to-end through the mapper's own vocabulary translation. This is the
// regression that motivated the whole change: the UI sends `ready`, and if that does not become
// `possession=ready-to-move` on the wire, "Ready to move" silently returns zero results.
const readyQuery = toQuery({ construction: 'ready' }, 'newest');
if (readyQuery.possession !== 'ready-to-move') {
  failures.push(
    `toQuery({construction:'ready'}) produced possession=${JSON.stringify(readyQuery.possession)}, ` +
      'expected "ready-to-move" — the filter would return nothing',
  );
}
const readyPage = await api(`/properties?possession=${readyQuery.possession}`);
if (!(readyPage.body?.totalElements > 0)) {
  failures.push('possession facet returned no rows for ready-to-move — is the V10 backfill applied?');
}
for (const row of toViewModelList(readyPage.body)) {
  if (row.construction !== 'ready') {
    failures.push(
      `possession facet leaked a row with construction=${JSON.stringify(row.construction)}`,
    );
    break;
  }
}
// "Not stated" must never satisfy the facet, or the filter promises something the data can't back.
const allRows = toViewModelList(livePage.body);
if (allRows.some((r) => r.construction === undefined)
  && toViewModelList(readyPage.body).some((r) => r.construction === undefined)) {
  failures.push('possession facet matched a listing with no recorded possession');
}

// Vocabulary drift must degrade quietly on the wire but loudly in the console: an unknown value maps
// to "not stated" (so nothing 422s and nothing crashes) while warning that this client is behind the
// contract. Silence here would recreate the exact bug the enum was introduced to fix.
const drift = [];
const realWarn = console.warn;
console.warn = (...args) => drift.push(args.join(' '));
const driftView = toViewModel({ id: 'x', slug: 'x', possession: 'coming-soon' });
const driftQuery = toQuery({ construction: 'coming-soon' }, 'newest');
console.warn = realWarn;

if (driftView.construction !== undefined) {
  failures.push(
    `an unknown wire possession produced construction=${JSON.stringify(driftView.construction)}; `
    + 'expected undefined ("not stated")',
  );
}
if (driftQuery.possession !== undefined) {
  failures.push(
    `an unknown UI construction produced possession=${JSON.stringify(driftQuery.possession)}; `
    + 'expected undefined so the request goes out unfiltered rather than being rejected',
  );
}
if (drift.length !== 2) {
  failures.push(
    `vocabulary drift produced ${drift.length} warning(s), expected 2 — unknown possession `
    + 'values are being dropped silently',
  );
}

// ─── The new seam operations, driven through the real http provider ───────────────────────────
//
// These replaced "fetch the whole catalogue and reduce it client-side". The value of that change is
// entirely in whether the answers stay *correct* once the catalogue no longer fits in one page, so
// the assertions below compare against `totalElements` — the server's count over the full result
// set — rather than against however many rows happened to come back.

const liveTotal = livePage.body.totalElements;
const counted = await live.countProperties({});
if (counted !== liveTotal) {
  failures.push(
    `countProperties({}) returned ${counted} but the catalogue holds ${liveTotal} — the count is `
    + 'reading a page rather than the whole result set, which is the exact bug it exists to prevent',
  );
}
const localityCount = await live.countProperties({ locality: liveRow.localitySlug });
const localityPage = await api(`/properties?locality=${encodeURIComponent(liveRow.localitySlug)}`);
if (localityCount !== localityPage.body?.totalElements) {
  failures.push(
    `countProperties({locality}) returned ${localityCount}, the API reports `
    + `${localityPage.body?.totalElements} — filters are not reaching the count query`,
  );
}
if (localityCount >= liveTotal) {
  failures.push(
    'countProperties ignored the locality filter (a filtered count matched the unfiltered total)',
  );
}

// Resolving a known id set must return those listings and silently drop ids that no longer exist —
// a saved property can be archived later, and that must not blank the Saved page.
const wantedIds = allRows.slice(0, 3).map((r) => r.id);
const resolved = await live.getPropertiesByIds([...wantedIds, 'definitely-not-a-real-listing']);
if (resolved.length !== wantedIds.length) {
  failures.push(
    `getPropertiesByIds resolved ${resolved.length} of ${wantedIds.length} known ids `
    + '(an unknown id must be dropped, not throw and not produce a hole)',
  );
}
if (resolved.some((r, i) => r.id !== wantedIds[i])) {
  failures.push('getPropertiesByIds did not preserve the requested order');
}
for (const row of resolved) {
  const missing = REQUIRED.filter((f) => row[f] === undefined);
  if (missing.length) {
    failures.push(`getPropertiesByIds returned a row missing required field(s): ${missing.join(', ')}`);
    break;
  }
}

// ─── Moderation: the queue, and the four decisions ────────────────────────────────────────────
//
// The writes are not driven here for the same reason `myListings`/`archiveListing` are not: they
// need a staff session and would mutate the dev DB. Their behaviour is covered by
// `PropertyModerationQueueTest`. What is checked here is everything that can go wrong *in the seam*
// — which is where the previous version of this slice was broken, not in the backend.

// 1. The four are implemented, not stubs. They were `notShipped` throwers pointing at guessed paths
//    (`PATCH /admin/properties/{id}/status`) that never existed; the real routes had shipped months
//    earlier. A stub and an implementation are both functions, so the surface check above cannot
//    tell them apart — calling one is the only way to know.
for (const fn of ['setListingStatus', 'toggleFeatured', 'flagListing', 'clearFlag']) {
  try {
    await live[fn]('definitely-not-a-real-listing', 'approved');
    failures.push(`${fn}() resolved for a nonexistent listing — it is not reaching the server`);
  } catch (err) {
    if (!err?.status) {
      failures.push(
        `${fn}() threw a non-HTTP error (${err?.message}) — it is still a stub rather than a request`,
      );
    }
  }
}

// 2. The queue is not public. This is the one moderation assertion that needs no token, and it is
//    also the most important: `/admin/properties` returns every listing at every status, including
//    other people's unpublished drafts.
const anonQueue = await api('/admin/properties');
if (anonQueue.status !== 401 && anonQueue.status !== 403) {
  failures.push(
    `GET /admin/properties returned ${anonQueue.status} to an anonymous caller — the moderation `
    + 'queue must never be readable without a staff session',
  );
}

// 3. The moderation read is a *separate operation*, on both providers. It was briefly inferred from
//    `includeAllStatuses`/`includeArchived` inside `listProperties`, which broke every owner's
//    dashboard: `useDashboardData.js` passes `includeAllStatuses: true` on a consumer page and was
//    routed to the staff-only endpoint, earning a 403. Asserting the surfaces match is what keeps
//    the two providers from disagreeing about which operations exist.
for (const [name, mod] of [['mock', mock], ['live', live]]) {
  if (typeof mod.listForModeration !== 'function') {
    failures.push(`${name} provider has no listForModeration — the admin list has no operation to call`);
  }
}

// ...and the public search must still refuse to honour the widenings, rather than quietly
// re-acquiring the inference. A consumer page passing these must get the public floor and a warning.
const stillUnsupported = unsupportedFilters({ includeAllStatuses: true, includeArchived: true });
if (stillUnsupported.length !== 2) {
  failures.push(
    'listProperties no longer reports includeAllStatuses/includeArchived as unsupported — either it '
    + 'is silently dropping them, or the moderation routing has been folded back into public search',
  );
}

// 4. An unfiltered moderation read must filter on **neither** axis. This is the inverse of the
//    public search's default, and it is the assertion that matters most here: while the routing was
//    inferred from `includeAllStatuses`/`includeArchived`, an absent flag re-imposed the public
//    floor — so `listForModeration({})` returned precisely the approved rows public search already
//    returns. The admin table showed 16 of 38 listings and reported no error at all.
const unfiltered = toModerationQuery({});
if (unfiltered.archived !== undefined || unfiltered.status !== undefined) {
  failures.push(
    'toModerationQuery({}) must not filter on status or archived — an unfiltered moderation read is '
    + `the whole queue, got archived=${unfiltered.archived} status=${unfiltered.status}`,
  );
}
// ...and it must still narrow when asked, which is what the admin tab filters do.
if (toModerationQuery({ status: 'pending' }).status !== 'pending') {
  failures.push('toModerationQuery dropped an explicit status filter');
}
if (toModerationQuery({ archived: true }).archived !== true) {
  failures.push('toModerationQuery dropped an explicit archived filter');
}

// 5. `archived` reaches the view model. It was hard-coded `false` in the mapper until the queue
//    shipped — defensible while every list was public, fatal on an ops list, where it made every
//    archived row look live and emptied the Archived filter.
if (toViewModel({ id: 'x', archived: true }).archived !== true) {
  failures.push(
    'toViewModel drops the `archived` flag — an ops list cannot distinguish archived listings, and '
    + 'the Archived filter silently returns nothing',
  );
}
if (toViewModel({ id: 'x' }).archived !== false) {
  failures.push('toViewModel must default `archived` to false, not undefined (callers test it directly)');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function compare(label, mockObj, liveObj, required, optional) {
  if (!mockObj || !liveObj) {
    failures.push(`${label}: ${!mockObj ? 'mock' : 'live'} returned nothing`);
    return;
  }
  for (const key of [...required, ...optional]) {
    if (mockObj[key] === undefined || liveObj[key] !== undefined) continue;
    const note = `${label}.${key}: in mock (${JSON.stringify(mockObj[key])}), absent live`;
    if (required.includes(key)) failures.push(`${note} — read without a fallback, this will break`);
    else warnings.push(`${note} — read as \`|| fallback\`, degrades gracefully`);
  }
  // Fail closed. A mock field in neither list is a field nobody has judged, and an unjudged gap is
  // how `construction` — which drives a *filter facet* — sat invisible behind a green check.
  // Every mock field must be explicitly classified or explicitly waived.
  for (const key of Object.keys(mockObj)) {
    if (required.includes(key) || optional.includes(key) || WAIVED.includes(key)) continue;
    failures.push(
      `${label}.${key}: unclassified — add it to REQUIRED, OPTIONAL, or WAIVED with a reason`,
    );
  }
  const mockOnly = Object.keys(mockObj).filter((k) => liveObj[k] === undefined);
  const liveOnly = Object.keys(liveObj).filter((k) => mockObj[k] === undefined);
  console.log(`  ${label}`);
  console.log(`    mock-only fields: ${mockOnly.length ? mockOnly.join(', ') : '(none)'}`);
  console.log(`    live-only fields: ${liveOnly.length ? liveOnly.join(', ') : '(none)'}`);
}

function typeCheck(label, mockObj, liveObj, keys) {
  if (!mockObj || !liveObj) return;
  for (const key of keys) {
    if (mockObj[key] === undefined || liveObj[key] === undefined) continue;
    const a = kind(mockObj[key]);
    const b = kind(liveObj[key]);
    if (a !== b) {
      failures.push(`${label}.${key}: mock is ${a}, live is ${b} — same name, different type`);
    }
  }
}

/** Merge a list into one object holding the first defined value seen for each key. */
function union(rows) {
  const out = {};
  for (const row of rows || []) {
    for (const [k, v] of Object.entries(row || {})) {
      if (v !== undefined && out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

function kind(v) {
  return Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
}

function qs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

async function api(path) {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Minimal in-memory Web Storage so the mock provider's lib/ dependencies run outside a browser. */
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
  // The mock core registers a `beforeunload` flush; harmless here, but the listener API must exist.
  globalThis.addEventListener ??= () => {};
  globalThis.removeEventListener ??= () => {};
}

function report() {
  console.log('');
  if (warnings.length) {
    console.log(`  ${warnings.length} tolerated difference(s):`);
    warnings.forEach((w) => console.log(`    ~ ${w}`));
    console.log('');
  }
  if (!failures.length) {
    console.log('  PASS — mock and live property providers agree on every field the UI relies on.');
    process.exit(0);
  }
  console.log(`  FAIL — ${failures.length} contract break(s):`);
  failures.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
