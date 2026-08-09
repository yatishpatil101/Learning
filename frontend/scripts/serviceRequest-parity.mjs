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
 * 2. **`details` is write-only.** `ServiceRequestCreate.details` is a flat string; `ServiceRequestDto`
 *    does not return it. So a live view model's `details` is `{}` — present (the view optional-chains
 *    it) but empty, never a fabricated value.
 * 3. **Draft / final documents live in `documents[]`, keyed by `category`.** Newest `draft` is the
 *    current version and their count is the version number; `final-document` is the registered copy.
 *    Their `url` is a signed URL, not a base64 `dataUrl`.
 * 4. **`authorRole` → `from`.** `buyer|owner|staff|admin` collapses to `user|staff`; anything not
 *    staff-side is the customer, or their own words render as ours.
 * 5. **`at` must be a number.** The thread sorts on it.
 * 6. **Co-fill and read-receipts have no endpoint** — `listPartyServiceRequests` is `[]` and
 *    `markServiceRequestRead` is a no-op against the API.
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

const BASE = args.get('base') || 'http://localhost:8081/api';
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

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);

// ─── The create body must carry only what the schema declares ─────────────────────────────────
const body = toCreate({
  type: 'valuation',
  service: 'Property Valuation',
  ticketRef: 'TR-should-not-leak',
  // A structured details object the schema cannot hold — it is a flat string on the wire.
  details: { property: 'Aundh, Pune', area: '1320 sq.ft', nested: { ignore: 'me' } },
});
for (const forbidden of ['service', 'ticketRef', 'customer', 'docs', 'status', 'assignee']) {
  if (forbidden in body) {
    failures.push(`toCreate leaked \`${forbidden}\` into the create body — the schema does not declare it, and an unknown property is ignored rather than rejected, so this would look like it worked`);
  }
}
if (!('type' in body) || !('details' in body)) failures.push('toCreate must always carry `type` and `details`');
if (typeof body.details !== 'string') failures.push('toCreate must flatten `details` to a string — the schema is a single string, not a tree');
if (typeof body.details === 'string' && body.details.includes('ignore')) {
  failures.push('toCreate serialised a nested object into `details` — nested values are dropped, only scalar fields become lines');
}
if ('propertyId' in body) failures.push('toCreate sent `propertyId` when none was given — the server validates it exists (404), so a free-text address must stay in the details string');

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
  // details is write-only on the wire: present but empty on read.
  if (created.details && Object.keys(created.details).length) {
    failures.push('the live provider reported non-empty `details` — it is write-only on the wire and must read back as {}');
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

// ─── Co-fill has no endpoint on the wire ──────────────────────────────────────────────────────
const party = await live.listPartyServiceRequests();
if (!Array.isArray(party) || party.length) {
  failures.push('listPartyServiceRequests must be an empty array in http mode — co-fill has no server endpoint');
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

// Status vocabulary: every known server status maps to its frontend step; an unknown survives.
for (const [wire, expected] of [
  ['new', 'submitted'],
  ['assigned', 'docs_review'],
  ['in-progress', 'docs_review'],
  ['draft-shared', 'draft_shared'],
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
// An approved request is the only draft decision recoverable on read (a rejection collapses to
// in-progress); it must surface as an `accepted` decision so the tracker shows the right state.
const approved = toViewModel({ id: 'r', type: 'legal', status: 'approved' });
if (approved.draftDecision?.type !== 'accepted') failures.push('an approved request must read back a draftDecision of `accepted`');

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
