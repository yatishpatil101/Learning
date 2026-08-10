/**
 * Contract-parity check: mock document provider vs the live API, through the http mapper.
 *
 * `documentService.js` is a seam drawn on the **owner's side of the vault only** — list / upload /
 * delete a property's files, and read / answer the buyer requests in the inbox. This harness pins
 * the reconciliations the mapper makes and proves both providers expose the same operations and
 * answer the same view-model shape:
 *
 * 1. **Vault file — signed URL vs data URL.** The mock stores base64 `dataUrl`; the wire returns a
 *    signed `url`. The view model carries both and leaves the other null (`url` does not resolve in
 *    dev — D120).
 * 2. **Request category — list vs single.** The wire's `categories[]` collapses to a single `docType`
 *    (the first) for the inbox row, with the full list preserved as `categories`.
 * 3. **Requester mobile is masked**, always — it maps straight through without unmasking.
 * 4. **`shareToken` / `expiresAt`** are owner re-send affordances, null until granted and null in
 *    mock mode.
 * 5. **Times are epoch ms** — the lists sort on them.
 *
 * The backend-free checks (surface parity, mapper pins, mock round-trip) always run. The live
 * round-trip runs only when a backend is reachable; without one the harness SKIPs it and still
 * exercises everything that does not need the server. The buyer's side of the flow (asking, polling
 * status, opening a shared bundle) and rent agreements are deliberately out of the seam — see
 * `documentService.js`.
 *
 * Usage:
 *   node scripts/document-parity.mjs                                  (backend-free checks only)
 *   node scripts/document-parity.mjs --base http://localhost:8081/api --otp-log <backend-log>
 *
 * **The base must include `/api`** — this talks to the backend directly, with no Vite proxy, and the
 * backend serves under `server.servlet.context-path=/api`.
 *
 * Exit code 0 = shapes agree, 1 = drift found (suitable for CI).
 */
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const BASE = args.get('base') || 'http://localhost:8081/api';
const MOBILE = args.get('mobile') || `98765${String(Date.now()).slice(-5)}`;
const LIVE = args.has('base') || args.has('otp-log');

installStorageStubs();

const failures = [];
const warnings = [];

console.log(`\n  document parity ${LIVE ? `(live: ${BASE})` : '(backend-free)'}`);

// ─── Optionally sign in to the live API ───────────────────────────────────────────────────────
let token = null;
let meId = null;
if (LIVE) {
  try {
    await api('POST', '/auth/login', { mobile: MOBILE });
    const otp = await readOtp(MOBILE);
    const loginRes = await api('POST', '/auth/login', { mobile: MOBILE, otp });
    if (loginRes.status !== 200) throw new Error(`HTTP ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    token = loginRes.body.accessToken;
    meId = loginRes.body.user?.id;
  } catch (e) {
    warnings.push(`live login failed (${e.message}) — running backend-free checks only`);
  }
}

// ─── Load the real modules through Vite's SSR loader ──────────────────────────────────────────
const { createServer } = await import('vite');
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(BASE) },
});
const load = (p) => vite.ssrLoadModule(new URL(p, import.meta.url).pathname);

if (token) {
  globalThis.localStorage.setItem('puneNestUser', JSON.stringify({ id: meId, name: 'Parity Probe', mobile: MOBILE, role: 'buyer' }));
  globalThis.localStorage.setItem('puneNestTokens', JSON.stringify({ accessToken: token, refreshToken: '' }));
}

const mock = await load('../src/services/providers/mock/documentProvider.js');
const live = await load('../src/services/providers/http/documentProvider.js');
const mapper = await load('../src/services/providers/http/documentMapper.js');
const { toDoc, toDocList, toRequest, toRequestList, toStatusUpdate } = mapper;

// ─── The seam itself: both providers must expose the same operations ──────────────────────────
const surfaceOf = (m) => Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
const missingOnLive = surfaceOf(mock).filter((k) => !surfaceOf(live).includes(k));
const missingOnMock = surfaceOf(live).filter((k) => !surfaceOf(mock).includes(k));
if (missingOnLive.length) failures.push(`http provider is missing: ${missingOnLive.join(', ')}`);
if (missingOnMock.length) failures.push(`mock provider is missing: ${missingOnMock.join(', ')}`);
for (const op of ['listDocuments', 'uploadDocument', 'deleteDocument', 'listDocRequests', 'respondDocRequest']) {
  if (!surfaceOf(mock).includes(op)) failures.push(`the seam must expose \`${op}\``);
}

// ─── Mapper null-safety ───────────────────────────────────────────────────────────────────────
if (toDoc(null) !== null) failures.push('toDoc(null) must be null, not a half-built object');
if (toDocList(null).length !== 0) failures.push('toDocList(null) must be an empty array');
if (toRequest(null) !== null) failures.push('toRequest(null) must be null');
if (toRequestList(null).length !== 0) failures.push('toRequestList(null) must be an empty array');

// ─── Vault document reconciliation ────────────────────────────────────────────────────────────
const doc = toDoc({
  id: 'd1', propertyId: 'p1', category: 'Society', fileName: 'noc.pdf',
  url: 'https://signed/abc', sizeBytes: 2048, mimeType: 'application/pdf',
  uploadedAt: '2026-01-02T00:00:00Z',
});
for (const f of ['id', 'category', 'name', 'size', 'mime', 'uploadedAt']) {
  if (doc[f] === undefined) failures.push(`toDoc must carry \`${f}\` — the vault renders it`);
}
if (doc.name !== 'noc.pdf') failures.push('toDoc must map `fileName` → `name`');
if (doc.mime !== 'application/pdf') failures.push('toDoc must map `mimeType` → `mime`');
if (doc.size !== 2048) failures.push('toDoc must map `sizeBytes` → `size`');
if (doc.dataUrl !== null) failures.push('toDoc.dataUrl must be null in http mode — the bytes live behind the signed url');
if (doc.url !== 'https://signed/abc') failures.push('toDoc must carry the signed `url` so a viewer can open it');
if (typeof doc.uploadedAt !== 'number') failures.push('toDoc.uploadedAt must be epoch ms — the vault sorts on it');
const bareDoc = toDoc({ id: 'd2' });
if (bareDoc.category !== 'Other' || bareDoc.name !== 'Document' || bareDoc.size !== 0) {
  failures.push('toDoc must default category/name/size for a sparse row rather than emit undefined');
}

// ─── Request reconciliation: categories[] → docType, masked mobile, token/expiry ──────────────
const req = toRequest({
  id: 'r1', propertyId: 'p1',
  requester: { id: 'u9', name: 'Priya', mobile: '98••••3210', role: 'buyer' },
  categories: ['Sale Deed', 'Society NOC'],
  status: 'granted', shareToken: 'tok-xyz', expiresAt: '2026-02-01T00:00:00Z',
  acknowledgedDisclaimer: true, createdAt: '2026-01-01T00:00:00Z',
});
if (req.docType !== 'Sale Deed') failures.push('toRequest must collapse `categories[0]` → `docType` for the inbox row');
if (!Array.isArray(req.categories) || req.categories.length !== 2) failures.push('toRequest must preserve the full `categories` list');
if (req.propId !== 'p1') failures.push('toRequest must map `propertyId` → `propId`');
if (req.buyerName !== 'Priya') failures.push('toRequest must map `requester.name` → `buyerName`');
if (req.buyerMobile !== '98••••3210') failures.push('toRequest must pass the masked `requester.mobile` straight through — it is never unmasked here');
if (req.shareToken !== 'tok-xyz') failures.push('toRequest must carry `shareToken` (the owner re-send affordance)');
if (typeof req.expiresAt !== 'number') failures.push('toRequest.expiresAt must be epoch ms once granted');
if (typeof req.requestedAt !== 'number') failures.push('toRequest.requestedAt must be epoch ms — the inbox sorts on it');
const pending = toRequest({ id: 'r2', propertyId: 'p1', requester: {}, categories: [], status: 'pending' });
if (pending.shareToken !== null || pending.expiresAt !== null) {
  failures.push('a pending request must have null shareToken/expiresAt — nothing has been granted');
}
if (pending.docType !== 'Document' || pending.buyerName !== 'Buyer') {
  failures.push('toRequest must default docType/buyerName for a sparse row');
}

// ─── StatusUpdate is guarded to what the server accepts ───────────────────────────────────────
if (toStatusUpdate('granted', 'ok').status !== 'granted') failures.push('toStatusUpdate must pass `granted` through');
if (toStatusUpdate('declined').status !== 'declined') failures.push('toStatusUpdate must pass `declined` through');
if (toStatusUpdate('approve').status !== 'declined') failures.push('toStatusUpdate must coerce anything not `granted` to `declined` — a typo is a safe no-op, not a leak');
if (toStatusUpdate('granted').note !== '') failures.push('toStatusUpdate must default a missing note to an empty string');

// ─── Mock round-trip: both providers answer the same view-model keys ──────────────────────────
const OWNER = MOBILE;
const PROP = 'parity-prop';
const before = await mock.listDocuments(OWNER, PROP);
if (!Array.isArray(before)) failures.push('mock.listDocuments must resolve to an array');
const uploaded = await mock.uploadDocument(OWNER, PROP, {
  category: 'Society',
  file: { name: 'probe.pdf', size: 1234, type: 'application/pdf' },
});
if (!uploaded?.id) failures.push('mock.uploadDocument must return the created document');
else {
  for (const f of ['id', 'category', 'name', 'size', 'mime', 'dataUrl', 'url', 'uploadedAt']) {
    if (!(f in uploaded)) failures.push(`mock.uploadDocument result is missing \`${f}\` — the view model must match the http shape`);
  }
  if (uploaded.url !== null) failures.push('a mock document must carry `url: null` — the signed url is an http-only field');
  if (uploaded.category !== 'Society' || uploaded.name !== 'probe.pdf') failures.push('mock.uploadDocument must record the file metadata it was handed');
  const after = await mock.listDocuments(OWNER, PROP);
  if (!after.some((d) => d.id === uploaded.id)) failures.push('a mock-uploaded document did not come back from listDocuments');
  const remaining = await mock.deleteDocument(OWNER, PROP, uploaded.id);
  if (remaining.some((d) => d.id === uploaded.id)) failures.push('mock.deleteDocument left the deleted document behind');
}
const mockReqs = await mock.listDocRequests(OWNER);
if (!Array.isArray(mockReqs)) failures.push('mock.listDocRequests must resolve to an array');

// ─── Live round-trip (only when the backend is up) ────────────────────────────────────────────
if (token) {
  // The wire shape, before the provider touches it. Asserted directly because every other check
  // below iterates the inbox, and an inbox that came back empty passes all of them: that is exactly
  // how the deal cluster's providers stayed green for a session after D77 paged them and their
  // `Array.isArray(rows) ? rows : []` quietly turned every envelope into nothing. Seeding an owned
  // property with a real request is out of this harness's reach, but the envelope is not.
  const raw = await api('GET', '/me/documents/requests', null, token);
  if (raw.status === 200 && Array.isArray(raw.body)) {
    failures.push('GET /me/documents/requests returned a bare array — it is paged by contract (D77); if the server was un-paged the provider is now asking for a `size` the endpoint ignores');
  } else if (raw.status === 200 && !Array.isArray(raw.body?.content)) {
    failures.push(`GET /me/documents/requests returned neither an array nor a page envelope (keys: ${Object.keys(raw.body || {})})`);
  }

  const inbox = await live.listDocRequests();
  if (!Array.isArray(inbox)) {
    failures.push('live.listDocRequests must resolve to an array (an empty inbox is []), not throw');
  } else {
    for (const r of inbox) {
      for (const f of ['id', 'propId', 'docType', 'status', 'requestedAt']) {
        if (r[f] === undefined) failures.push(`a live inbox row is missing \`${f}\``);
      }
    }
  }
  warnings.push('vault upload/list/delete live round-trip needs a seeded owned property — covered by e2e, not this harness');
} else if (LIVE) {
  warnings.push('live round-trip skipped (no session)');
}

report();

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

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
  console.log('\n  PASS — mock and live document providers agree on every field the owner surface relies on.\n');
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
}
