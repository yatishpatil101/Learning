/**
 * Contract-parity check: mock service-request provider vs the live API, through the http mapper.
 *
 * `serviceRequestService.js` is a seam — `ServiceTracker.jsx` is written against one interface and
 * must not care which provider answered. This is the widest gap in the seam, so the harness pins the
 * places the mock is richer than the wire and the places their vocabularies simply differ:
 *
 * 1. **Status is two vocabularies.** The stepper keys on `submitted|docs_review|draft_shared|...`;
 *    the server has `new|assigned|in-progress|draft-shared|...`. The mapper must translate every
 *    known one and **pass an unknown one through unchanged** — collapsing it onto a state the UI
 *    knows would erase a distinction ops made.
 * 2. **`details` is a structured object, round-tripped.** ~~`ServiceRequestCreate.details` is a flat
 *    string; `ServiceRequestDto` does not return it, so a live view model's `details` is `{}`.~~
 *    **That was true until D119 (`59ab9c7`, 2026-08-09), which made `details` a jsonb object the
 *    server stores as-is and echoes back.** The claim is kept and struck through rather than
 *    deleted because this harness went on asserting the reversed contract for eleven days — it was
 *    even edited on 2026-08-12 without being run. `toCreate` now passes the object through
 *    untouched and `toViewModel` reads `dto.details`, defaulting a missing one to `{}` so the
 *    view's optional chaining stays safe.
 * 3. **Draft / final documents live in `documents[]`, keyed by `category`.** Newest `draft` is the
 *    current version and their count is the version number; `final-document` is the registered copy.
 *    Their `url` is a signed URL, not a base64 `dataUrl`.
 * 4. **`authorRole` → `from`.** `buyer|owner|staff|admin` collapses to `user|staff`; anything not
 *    staff-side is the customer, or their own words render as ours.
 * 5. **`at` must be a number.** The thread sorts on it.
 * 6. **The legacy co-fill merge is empty live, and read-receipts have no endpoint** —
 *    `listPartyServiceRequests` is `[]` and `markServiceRequestRead` is a no-op against the API.
 *    ~~Co-fill has no endpoint.~~ **V107 shipped one** (`POST /service-requests/{id}/parties`,
 *    `GET /me/service-request-invites`), so the old reason is gone but the assertion stands on a
 *    new one: live, an accepted party's request is already in `listServiceRequests`, so returning
 *    rows from this second bucket too would double every one of them.
 * 7. **The drafting desk's four operations are live-only** (D184). Point 1 is the reason: a queue
 *    filter that sends the server's status against the stepper's rows matches nothing, and the
 *    translation table that would paper over it was rejected. So the mock no longer implements
 *    them, and this harness names the exception rather than asserting a symmetry that is now false.
 *
 * Usage (backend must be running):
 *   node scripts/serviceRequest-parity.mjs --otp-log <path-to-backend-console-log>
 *   node scripts/serviceRequest-parity.mjs --base http://localhost:8081/api   (prompts for the OTP)
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

globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ id: meId, name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({
  accessToken: token,
  refreshToken: loginRes.body.refreshToken,
}));

const mock = await load('../src/services/providers/mock/serviceRequestProvider.js');
const live = await load('../src/services/providers/http/serviceRequestProvider.js');
const { toCreate, toViewModel, toViewModelList } = await load('../src/services/providers/http/serviceRequestMapper.js');

// The mock store is seeded by an async dynamic `import()` of `data/db.json`, so a mock read issued
// before it lands throws "localStorage[puneNestDB_v5] is missing". In the browser `main.jsx` awaits
// this before rendering; a script has no boot gate, so it must await it here. Skipping it does not
// fail every time — it is a race, and it was losing on one port while winning on another, which is
// the worst shape a check can have: a harness that is red for a reason that has nothing to do with
// the contract it exists to police.
await (await load('../src/lib/mockApi.js')).ensureMockDb();

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
// …with one named exception. The drafting desk (D184) is http-only: the mock's rows carry the
// stepper's statuses, so its queue read answered most `?status=` filters with an empty page — a
// work queue that lies about being idle. Rather than translate between the vocabularies, the desk
// operations were removed from the mock and `OpsDraftingDesk.jsx` gates itself on
// `isHttpDomain('serviceRequest')`. They are listed here so the exception has to be deleted on
// purpose if the mock ever implements them again — and so a *fifth* operation quietly going
// live-only still fails.
//
// `readServiceRequestChecklist` is the fourth, added 2026-08-20. It was **not** a stale assertion:
// this list said three, the desk had grown a fourth, and the harness failed exactly as its author
// intended. It is a desk operation on the same terms as the others — its only consumer is
// `OpsDraftingDesk.jsx`, behind the same `isHttpDomain` gate. Recording it here is the deliberate
// deletion of the exception that the comment above asks for, not a silencing of the check.
const DESK_ONLY = ['listServiceRequestQueue', 'readServiceRequestChecklist', 'readServiceRequestIdentities', 'takeServiceRequest'];
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k) && !DESK_ONLY.includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);
// The exception is only legitimate while the http provider actually has them.
const deskGone = DESK_ONLY.filter((k) => !surfaceOf(live).includes(k));
if (deskGone.length) failures.push(`http provider is missing the drafting desk's own operations: ${deskGone.join(', ')}`);
const deskBack = DESK_ONLY.filter((k) => surfaceOf(mock).includes(k));
if (deskBack.length) {
  failures.push(
    `the mock re-implements ${deskBack.join(', ')} — D184 retired the mock drafting desk because its `
    + 'status vocabulary is the stepper\'s, not the server\'s. If this is deliberate, drop it from DESK_ONLY.',
  );
}

// ─── The create body must carry only what the schema declares ─────────────────────────────────
const body = toCreate({
  type: 'valuation',
  service: 'Property Valuation',
  ticketRef: 'TR-should-not-leak',
  // A structured details object, which since D119 the schema holds as jsonb and echoes back.
  details: { property: 'Aundh, Pune', area: '1320 sq.ft', nested: { keep: 'me' } },
});
for (const forbidden of ['service', 'ticketRef', 'customer', 'docs', 'status', 'assignee']) {
  if (forbidden in body) {
    failures.push(`toCreate leaked \`${forbidden}\` into the create body — the schema does not declare it, and an unknown property is ignored rather than rejected, so this would look like it worked`);
  }
}
if (!('type' in body) || !('details' in body)) failures.push('toCreate must always carry `type` and `details`');
if (typeof body.details !== 'object' || body.details === null || Array.isArray(body.details)) {
  failures.push('toCreate must pass `details` through as an object — D119 made it jsonb; flattening it to a string would lose the structure the tracker reads back');
}
if (body.details?.nested?.keep !== 'me') {
  failures.push('toCreate dropped a nested value from `details` — the server stores the object as-is, so nesting must survive rather than be flattened away');
}
if ('propertyId' in body) failures.push('toCreate sent `propertyId` when none was given — the server validates it exists (404), so a free-text address must stay in `details.property`');

// ─── Round trip: raise one, message it, read it back ──────────────────────────────────────────
const created = await live.createServiceRequest({
  type: 'valuation',
  service: 'Property Valuation',
  details: { property: 'Aundh, Pune', purpose: 'Parity probe' },
});
if (!created?.id) {
  failures.push('createServiceRequest returned no id');
} else {
  assertRequestShape(created, 'the created request');
  // The server opens every request `new`, which the mapper maps to the frontend `submitted` step.
  if (created.status !== 'submitted') {
    failures.push(`a fresh live request came back status=${JSON.stringify(created.status)} — the server opens \`new\`, which must map to the frontend \`submitted\``);
  }
  // details round-trips (D119). Asserting the value we sent comes back is the whole point: it is
  // the one field whose loss would be invisible, since the tracker optional-chains it and an empty
  // object renders as a blank line rather than an error.
  if (created.details?.property !== 'Aundh, Pune' || created.details?.purpose !== 'Parity probe') {
    failures.push(`the live provider did not round-trip \`details\` — sent {property, purpose}, read back ${JSON.stringify(created.details)}. D119 stores it as jsonb and echoes it; a mapper that drops it blanks the tracker's detail line silently`);
  }
  if (created.draft !== null || created.finalDoc !== null) {
    failures.push('a fresh request must have null draft/finalDoc — nothing has been shared yet');
  }

  const afterMsg = await live.addServiceRequestMessage(created.id, 'Parity probe message.');
  if (!afterMsg?.id) failures.push('addServiceRequestMessage returned no request');
  if (afterMsg && !afterMsg.messages.some((m) => m.from === 'user' && m.text === 'Parity probe message.')) {
    failures.push('the message just posted did not come back on the thread as a `user` bubble');
  }

  // No read-receipt endpoint — must resolve without throwing.
  await live.markServiceRequestRead(created.id);

  const full = await live.getServiceRequest(created.id);
  if (!full) {
    failures.push('getServiceRequest did not return the request we just created');
  } else {
    assertRequestShape(full, 'the fetched request');
    if (full.updatedAt < full.createdAt) {
      failures.push('`updatedAt` is older than `createdAt` — it is derived from the latest activity and must never go backwards');
    }
  }
}

// ─── The list, and that `type` narrows by row-match (not by count) ────────────────────────────
const list = await live.listServiceRequests();
if (!Array.isArray(list)) {
  failures.push('listServiceRequests must resolve to an array');
} else {
  if (created?.id && !list.some((r) => r.id === created.id)) {
    failures.push('a request raised through the live provider did not come back from listServiceRequests');
  }
  for (let i = 1; i < list.length; i += 1) {
    if (list[i - 1].updatedAt < list[i].updatedAt) {
      failures.push('listServiceRequests is not sorted newest-activity-first');
      break;
    }
  }
}
if (created?.id) {
  const valuations = await live.listServiceRequests('valuation');
  const others = await live.listServiceRequests('legal');
  if (Array.isArray(valuations) && !valuations.some((r) => r.id === created.id)) {
    failures.push('type=valuation did not return our valuation request — the filter must match by row, not narrow it away');
  }
  if (Array.isArray(others) && others.some((r) => r.id === created.id)) {
    failures.push('type=legal returned our valuation request — the filter is not actually narrowing by type');
  }
  if (Array.isArray(valuations) && valuations.some((r) => r.type && r.type !== 'valuation')) {
    failures.push('type=valuation returned a request of another type — the server filter is being ignored');
  }
}

// ─── The legacy co-fill merge stays empty live ──────────────────────────────────────────
const party = await live.listPartyServiceRequests();
if (!Array.isArray(party) || party.length) {
  failures.push('listPartyServiceRequests must be an empty array in http mode — not because co-fill is missing (V107 shipped it) but because an accepted party\'s request is already in listServiceRequests, so a second bucket would double every row');
}

// ─── Both providers must answer the same shape ────────────────────────────────────────────────
const mockList = await mock.listServiceRequests();
if (!Array.isArray(mockList)) failures.push('mock listServiceRequests must resolve to an array');

// ─── Null-safety and the vocabularies, driven through the mapper directly ─────────────────────
if (toViewModel(null) !== null) failures.push('toViewModel(null) must be null, not a half-built object');
if (toViewModelList(null).length !== 0) failures.push('toViewModelList(null) must be an empty array');

const defaults = toViewModel({ id: 'r1', type: 'legal' });
if (typeof defaults.service !== 'string' || !defaults.service) failures.push('toViewModel must always derive a `service` name from the type');
if (defaults.service !== 'Property & Legal') failures.push(`type=legal should read as "Property & Legal", got ${JSON.stringify(defaults.service)}`);
if (defaults.details == null || typeof defaults.details !== 'object') failures.push('toViewModel must default `details` to an object — the view optional-chains it');
if (!Array.isArray(defaults.docs)) failures.push('toViewModel must default `docs` to an array');
if (!Array.isArray(defaults.messages)) failures.push('toViewModel must default `messages` to an array');
if (typeof defaults.updatedAt !== 'number') failures.push('toViewModel must always produce a numeric `updatedAt`');

// `parties` (V107) must survive the mapper. This assertion is here because its absence cost a
// cycle: `toViewModel` silently dropped `dto.parties`, and nothing caught it until a live e2e spec
// read back `undefined` and threw. A dropped field is invisible to every check that only inspects
// the fields it knows about — the wizard rendered, it just never showed the invite. So assert the
// passthrough of the whole row, not merely that the key exists.
const withParties = toViewModel({
  id: 'r2',
  type: 'rent',
  parties: [{ id: 'p1', role: 'tenant', status: 'invited', pending: true, mobile: '98XXXXX210', invitedBy: 'u1' }],
});
if (!Array.isArray(withParties.parties) || withParties.parties.length !== 1) {
  failures.push(`toViewModel dropped \`parties\` — got ${JSON.stringify(withParties.parties)}. The co-fill panel reads it to tell an owner which wait they are in; losing it renders a blank panel rather than an error`);
} else {
  for (const k of ['id', 'role', 'status', 'pending', 'mobile', 'invitedBy']) {
    if (!(k in withParties.parties[0])) failures.push(`toViewModel dropped \`parties[].${k}\` — the panel branches on pending/mobile to distinguish an unregistered invitee from an unanswered one`);
  }
}
if (!Array.isArray(toViewModel({ id: 'r3', type: 'rent' }).parties)) {
  failures.push('toViewModel must default `parties` to an array — the panel maps over it unguarded');
}

// Status vocabulary: every known server status maps to its frontend step; an unknown survives.
for (const [wire, expected] of [
  ['new', 'submitted'],
  ['assigned', 'docs_review'],
  ['in-progress', 'docs_review'],
  ['draft-shared', 'draft_shared'],
  ['changes-requested', 'changes_requested'],
  ['approved', 'approved'],
  ['completed', 'completed'],
  ['cancelled', 'cancelled'],
]) {
  const got = toViewModel({ id: 'r', type: 'legal', status: wire }).status;
  if (got !== expected) failures.push(`status ${JSON.stringify(wire)} mapped to ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
const unknown = toViewModel({ id: 'r', type: 'legal', status: 'on-hold' }).status;
if (unknown !== 'on-hold') {
  failures.push(`an unknown status was coerced to ${JSON.stringify(unknown)} — pass it through instead; erasing a distinction ops made is worse than an unstyled label`);
}
// Both draft decisions are recoverable on read, because the server has a distinct status for each:
// `approved` is an acceptance and `changes-requested` is a rejection. The tracker and the ops queue
// both branch on `draftDecision.type`, so getting either wrong shows the customer the wrong state.
const approved = toViewModel({ id: 'r', type: 'legal', status: 'approved' });
if (approved.draftDecision?.type !== 'accepted') failures.push('an approved request must read back a draftDecision of `accepted`');
const rejected = toViewModel({ id: 'r', type: 'legal', status: 'changes-requested' });
if (rejected.draftDecision?.type !== 'changes') failures.push('a changes-requested request must read back a draftDecision of `changes`');

// Message roles and time.
for (const [role, expected] of [['buyer', 'user'], ['owner', 'user'], [null, 'user'], ['staff', 'staff'], ['admin', 'staff']]) {
  const bubble = toViewModel({ id: 'r', type: 'legal', messages: [{ id: 'm', authorRole: role, body: 'x', createdAt: new Date().toISOString() }] }).messages[0];
  if (bubble.from !== expected) failures.push(`authorRole=${JSON.stringify(role)} mapped to the ${bubble.from} side, expected ${expected}`);
  if (typeof bubble.at !== 'number') failures.push(`message \`at\` must be a number for authorRole=${JSON.stringify(role)}, got ${typeof bubble.at}`);
}

// Document projection: newest draft is current, count is the version; final-document is separate.
const withDocs = toViewModel({
  id: 'r',
  type: 'legal',
  status: 'completed',
  documents: [
    { id: 'd1', category: 'draft', fileName: 'draft-v1.pdf', url: 'https://x/1', uploadedAt: '2026-01-01T00:00:00Z' },
    { id: 'd2', category: 'draft', fileName: 'draft-v2.pdf', url: 'https://x/2', uploadedAt: '2026-01-02T00:00:00Z' },
    { id: 'd3', category: 'final-document', fileName: 'final.pdf', url: 'https://x/3', uploadedAt: '2026-01-03T00:00:00Z' },
    { id: 'd4', category: 'service-request', fileName: 'kyc.pdf', url: 'https://x/4', uploadedAt: '2026-01-01T00:00:00Z' },
  ],
});
if (withDocs.draft?.fileName !== 'draft-v2.pdf') failures.push('draft must be the newest `draft`-category document');
if (withDocs.draft?.version !== 2) failures.push('draft.version must be the count of draft documents (the contract has no version field)');
if (withDocs.draft?.dataUrl !== 'https://x/2') failures.push('draft.dataUrl must carry the signed url of the newest draft');
if (withDocs.finalDoc?.fileName !== 'final.pdf') failures.push('finalDoc must be the `final-document`-category document');
if (withDocs.docs.length !== 0) failures.push('customer checklist docs have no read representation — `docs` must stay empty in http mode');

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function assertRequestShape(r, what) {
  for (const f of ['id', 'type', 'service', 'status']) {
    if (typeof r[f] !== 'string') failures.push(`${what} is missing \`${f}\` — the card renders it`);
  }
  if (!Array.isArray(r.messages)) failures.push(`${what} must carry a \`messages\` array`);
  if (r.details == null || typeof r.details !== 'object') failures.push(`${what} must carry a \`details\` object (empty in http mode) — the view optional-chains it`);
  if (!Array.isArray(r.docs)) failures.push(`${what} must carry a \`docs\` array`);
  if (typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') {
    failures.push(`${what} must carry numeric \`createdAt\`/\`updatedAt\` — the list sorts on them`);
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
  console.log('\n  PASS — mock and live service-request providers agree on every field the UI relies on.\n');
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
