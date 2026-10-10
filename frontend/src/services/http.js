// The only `fetch` in the service layer. Transport contract and the reasoning behind it:
// docs/system/frontend-data-seam.md
import { API_BASE } from './config.js';
import {
  isInternal, localStorageWritable, logoutUser, readAccessToken, readUser, sessionRemembered, writeTokens,
} from '../lib/auth.js';

const TRACE_HEADER = 'X-Trace-Id';
/** Opaque id of the build that answered. Set by the backend's `BuildStampFilter`. */
const BUILD_HEADER = 'X-Draazy-Build';
const REFRESH_PATH = '/auth/refresh';
/** Name of the cross-tab Web Lock that serialises token refreshes. */
const REFRESH_LOCK = 'draazy:auth-refresh';

// Branch on `code`, the backend's stable machine-readable string — never on `message`, which is
// human-facing and may be reworded at any time.
export class ApiError extends Error {
  constructor({ code, message, status, traceId, fields, attemptsRemaining, retryAfterSeconds }) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.code = code || null;
    this.status = status;
    this.traceId = traceId || null;
    /** Field-level messages from a 422, as `[{ field, message }]`. Empty for other statuses. */
    this.fields = fields || [];
    /** Guesses left against a rejected OTP. `null`, never 0, so absence cannot read as lockout. */
    this.attemptsRemaining =
      typeof attemptsRemaining === 'number' ? attemptsRemaining : null;
    /** The *remaining* wait a rate-limited response reports; `null` on every other status. */
    this.retryAfterSeconds =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds : null;
  }

  /** True when the failure was a validation rejection, so a form can map `fields` onto inputs. */
  get isValidation() {
    return this.status === 422;
  }
}

/** Thrown when the network never reached the server (offline, DNS, connection refused). */
export class NetworkError extends Error {
  constructor(cause) {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

// True for the rejection `fetch` produces when its `AbortSignal` fires — never a failure. Why it
// must not reach the reachability observer: docs/system/frontend-data-seam.md
export const isAbort = (err) => err?.name === 'AbortError';

/** The single reachability listener, or null when nobody is watching. @see observeReachability */
let reachabilityObserver = null;

// One listener, called once per HTTP attempt. Contract (a 500 counts as "answered") and why it is
// an inversion: docs/system/frontend-data-seam.md
export function observeReachability(fn) {
  reachabilityObserver = fn;
}

/** The single build-stamp listener, or null when nobody is watching. @see observeBuildStamp */
let buildStampObserver = null;

// Called once per HTTP attempt with `X-Draazy-Build`, or `null`. Inverted like
// `observeReachability`: importing the consumer here would reinstate the provider import cycle.
export function observeBuildStamp(fn) {
  buildStampObserver = fn;
}

// Opts: `method`, `body`, `query`, `headers`, `auth`, `withStatus`, `signal`. Their exact
// semantics, and what `withStatus` is for: docs/system/frontend-data-seam.md
export async function request(path, opts = {}) {
  try {
    return await exchange(path, opts);
  } finally {
    // A refused write (409, 404…) usually means client and server state diverged, so the re-read
    // that recovers from it must not be served from the cache either.
    if ((opts.method ?? 'GET') !== 'GET' && !opts.keepReads) clearReads();
  }
}

async function exchange(path, opts) {
  const { auth = true, withStatus = false } = opts;
  const res = await send(path, opts, auth ? readAccessToken() : null);

  // Refresh and replay once (never for `/auth/refresh` itself: docs/flows/consumer/auth.md). A wrong-code
  // 401 carries `attemptsRemaining` and is not replayed, since that would spend a second guess.
  if (res.status === 401 && auth && path !== REFRESH_PATH && readAccessToken() && !(await isWrongCode(res))) {
    const token = await refreshAccessToken();
    if (token) return toResult(await send(path, opts, token), withStatus);
    // Reached only when the server actually refused; an unreachable server throws instead, so this
    // sign-out always follows an answer rather than the absence of one.
    endSession();
  }

  return toResult(res, withStatus);
}

// Concurrent identical reads share one fetch; `ttl` (ms) keeps a result, and a primed seed until its first reader.
// Any write drops everything, so a read after a write is never stale.
const reads = new Map();
// Bumped on every clear, so a read that was in flight across a write is not kept as fresh.
let readGeneration = 0;
function clearReads() {
  reads.clear();
  readGeneration += 1;
}

function endSession() {
  clearReads();
  logoutUser();
}

// Registered at module load, so it runs before every listener that re-reads on this signal.
globalThis.addEventListener?.('draazy-settings-change', clearReads);

const readKey = (path, query, auth = true) =>
  `${auth ? readAccessToken() ?? '' : ''} ${path}${buildQuery(query)}`;

function forget(key, entry) {
  if (reads.get(key) === entry) reads.delete(key);
}

function track(key, promise, { ttl = 0, once = false } = {}) {
  const entry = { until: Infinity, once };
  const generation = readGeneration;
  entry.promise = promise.then(
    (data) => {
      entry.settled = true;
      if (ttl > 0 && !entry.taken && generation === readGeneration) entry.until = Date.now() + ttl;
      else forget(key, entry);
      return data;
    },
    (err) => { forget(key, entry); throw err; },
  );
  reads.set(key, entry);
  return entry;
}

// The shared fetch carries no caller's signal, so one caller aborting cannot fail the others.
function abortable(promise, signal) {
  if (!signal) return promise;
  const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function get(path, query, opts = {}) {
  const { ttl, signal, ...rest } = opts;
  if (rest.withStatus || rest.headers) return request(path, { ...rest, method: 'GET', query, signal });
  const key = readKey(path, query, rest.auth);
  const hit = reads.get(key);
  if (!hit || hit.until <= Date.now()) {
    return abortable(track(key, request(path, { ...rest, method: 'GET', query }), { ttl }).promise, signal);
  }
  hit.read = true;
  if (hit.once) {
    hit.taken = true;
    if (hit.settled) forget(key, hit);
  }
  return abortable(hit.promise, signal);
}

// Long enough to absorb the reads a page's panels repeat while mounting; any write clears it first.
export const PAGE_LOAD_TTL = 5_000;

// Seeds the read `get(path, query)` would make with a value fetched elsewhere; a null or failed seed falls back.
// An unread seed is dropped so the next `get` can surface its own error; without `ttl` it is single-use.
export function prime(path, query, value, { ttl } = {}) {
  let entry;
  const fallback = () => (entry.read
    ? request(path, { method: 'GET', query })
    : Promise.reject(new Error('unread seed')));
  entry = track(readKey(path, query), value.then((data) => data ?? fallback(), fallback), ttl ? { ttl } : { ttl: 10_000, once: true });
  entry.promise.catch(() => {});
}
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
// PUT carries no body on the endpoints that use it so far (`/me/saved/{id}` is an idempotent
// set-membership write, where the URL is the whole request); `body` stays in the signature anyway.
export const put = (path, body, opts) => request(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => request(path, { ...opts, method: 'DELETE' });

// The one content type the JSON path above cannot carry. Why it is a thin sibling of `post` rather
// than a branch: docs/system/frontend-data-seam.md
export const postMultipart = (path, form, opts) => request(path, { ...opts, method: 'POST', body: form });

export async function openEventStream(path, { onEvent, onOpen, signal } = {}) {
  let res = await stream(path, readAccessToken(), signal);
  if (res.status === 401 && readAccessToken()) {
    const token = await refreshAccessToken();
    if (token) res = await stream(path, token, signal);
    else endSession();
  }
  if (!res.ok) return toResult(res);
  onOpen?.();
  await readEventStream(res.body, onEvent);
  return null;
}

// Read a `PageEnvelope` into the shape the seam uses — one place to be wrong. Field precedence
// (never fall back to the requested page): docs/system/frontend-data-seam.md
export function unwrapPage(res, requested = {}) {
  // A bare array is a legitimate response from the endpoints that are deliberately unpaged
  // (bounded reads, e.g. a property's reviews), so normalise rather than treating it as malformed.
  const items = Array.isArray(res) ? res : (res?.content ?? []);
  return {
    items,
    page: res?.page ?? res?.number ?? requested.page ?? 0,
    size: res?.size ?? requested.size ?? items.length,
    // `totalElements` counts the whole result set, not this page. Falling back to `items.length` is
    // only correct for the unpaged case above, where the page IS the result set.
    total: res?.totalElements ?? items.length,
    totalPages: res?.totalPages ?? 0,
  };
}

// Re-exported so existing importers keep working; the value lives in `./apiLimits.js`, outside the
// provider import cycle. New provider code imports it from there.
export { MAX_PAGE_SIZE } from './apiLimits.js';

// Read a paged endpoint the UI consumes as a plain list, saying so out loud when it overflows. Why
// `?size=100` is honest and why the warning names the caller: docs/system/frontend-data-seam.md
export function unwrapFullPage(res, label) {
  if (Array.isArray(res)) return res;
  const rows = res?.content ?? [];
  const total = res?.totalElements ?? rows.length;
  if (total > rows.length) {
    console.warn(
      `[${label}] ${total} rows exist but only ${rows.length} were fetched. This list, and any ` +
        'count or filter computed from it, is now reading a partial result — the screen needs a pager.',
    );
  }
  return rows;
}

/** True for a `multipart/form-data` body: the platform owns its `Content-Type` (boundary and all). */
const isFormData = (body) => typeof FormData !== 'undefined' && body instanceof FormData;

// index.html starts `GET /bootstrap` (user-independent) before the bundle loads, and the first read
// of it takes that response (once: a body reads once). Staff skip it because their reads revalidate.
function takeEarlyRead(url) {
  const early = globalThis.__dzBootstrap;
  if (url !== '/bootstrap' || !early || isInternal(readUser())) return null;
  globalThis.__dzBootstrap = undefined;
  return early;
}

async function send(path, { method = 'GET', body, query, headers: extra, signal }, token) {
  const headers = { Accept: 'application/json' };
  // JSON is the common case; a FormData body is serialised by the platform, which also sets the
  // Content-Type (with its boundary) — setting it here by hand would break the multipart parse.
  if (body !== undefined && !isFormData(body)) headers['Content-Type'] = 'application/json';
  // Caller headers are merged *before* Authorization, so a stray `Authorization` in `extra` cannot
  // displace the real session token — the one header that must never be a per-call decision.
  if (extra) Object.assign(headers, extra);
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const early = method === 'GET' ? takeEarlyRead(path + buildQuery(query)) : null;
    const res = (early && await early) || await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers,
      // The refresh token rides an HttpOnly cookie. Same-origin this is a no-op; it earns its place
      // only in the cross-origin `VITE_API_BASE` deployment — docs/system/frontend-data-seam.md.
      credentials: 'include',
      // Staff revalidate every read, so an editor never sees the anonymous-visitor cache;
      // consumers accept its few seconds: PublicReadCacheFilter.java, docs/system/cross-cutting.md §9.
      cache: isInternal(readUser()) ? 'no-cache' : 'default',
      body: body === undefined ? undefined : isFormData(body) ? body : JSON.stringify(body),
      signal,
    });
    // The server answered — whatever its status, the connection is demonstrably working, so clear
    // any standing "can't reach" verdict: a 500 is as much proof of reachability as a 200.
    reachabilityObserver?.(null);
    // Read from every answer, statuses included: a deploy that moved the contract shows up as a 4xx,
    // so the response most in need of explaining is the one watching only successes would skip.
    buildStampObserver?.(res.headers.get(BUILD_HEADER));
    return res;
  } catch (cause) {
    // An abort is the caller's own decision: neither an error to normalise nor evidence about the
    // network, so it is rethrown unchanged and reported to nobody.
    if (isAbort(cause)) throw cause;
    const err = new NetworkError(cause);
    reachabilityObserver?.(err);
    throw err;
  }
}

async function stream(path, token, signal) {
    const headers = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(API_BASE + path, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal,
      });
      reachabilityObserver?.(null);
      buildStampObserver?.(res.headers.get(BUILD_HEADER));
      return res;
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      const err = new NetworkError(cause);
      reachabilityObserver?.(err);
      throw err;
    }
}

async function readEventStream(body, onEvent) {
    if (!body?.getReader) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    let data = [];
    const dispatch = () => {
      if (data.length) {
        const text = data.join('\n');
        let payload = text;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
        onEvent?.({ type: event, data: payload });
      }
      event = 'message';
      data = [];
    };
    const line = (raw) => {
      const next = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!next) { dispatch(); return; }
      if (next.startsWith(':')) return;
      const split = next.indexOf(':');
      const field = split === -1 ? next : next.slice(0, split);
      const value = split === -1 ? '' : next.slice(split + 1).replace(/^ /, '');
      if (field === 'event') event = value || 'message';
      else if (field === 'data') data.push(value);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(line);
    }
    buffer += decoder.decode();
    if (buffer) line(buffer);
    dispatch();
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    // Repeat the key for arrays (`?amenity=lift&amenity=gym`) — the format Spring binds to List<T>.
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.append(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function toResult(res, withStatus = false) {
  const payload = await parseBody(res);
  if (res.ok) return withStatus ? { data: payload, status: res.status, etag: res.headers.get('ETag') } : payload;
  throw new ApiError({
    code: payload?.error,
    message: payload?.message,
    status: res.status,
    // Prefer the body's traceId, but fall back to the header: 502s and other proxy-level failures
    // never reach our exception handler and so carry no envelope at all.
    traceId: payload?.traceId || res.headers.get(TRACE_HEADER),
    fields: payload?.fields,
    attemptsRemaining: payload?.attemptsRemaining,
    // From the envelope, not the `Retry-After` header beside it: the API exposes no CORS response
    // headers, so a browser on another origin can read the body and nothing else.
    retryAfterSeconds: payload?.retryAfterSeconds,
  });
}

async function isWrongCode(res) {
  return (await parseBody(res.clone()))?.attemptsRemaining != null;
}

async function parseBody(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body means something upstream of the app answered (proxy, gateway, HTML error
    // page). Keep it as a message rather than masking the real cause with a parse error.
    return { message: text.slice(0, 200) };
  }
}

// Coalesces concurrent callers within and across tabs. Why both layers are load-bearing, and where
// the lock degrades: docs/flows/consumer/auth.md
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    const entryToken = readAccessToken();
    refreshInFlight = exclusively(() => doRefresh(entryToken))
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

// Degrades to inline execution rather than rejecting — a raw `SecurityError` would escape the
// ApiError/NetworkError normalisation.
function exclusively(fn) {
  if (!navigator.locks) {
    console.warn('[http] navigator.locks unavailable (non-secure context?) — refresh is not '
      + 'serialised across tabs; concurrent refreshes rely on the server grace window');
    return fn();
  }
  try {
    return navigator.locks.request(REFRESH_LOCK, fn);
  } catch (err) {
    console.warn('[http] Web Lock request refused — refreshing without cross-tab serialisation', err);
    return fn();
  }
}

async function doRefresh(entryToken) {
  const current = readAccessToken();
  // Another tab rotated or signed out while we queued: presenting the cookie it just replaced is
  // what trips reuse-detection. `entryToken &&` is load-bearing — docs/flows/consumer/auth.md.
  if (entryToken && current !== entryToken) return current;
  // Resolved once, before the request: a second read would straddle the response's own `Set-Cookie`
  // and answer with the value the first read just caused.
  const remember = sessionRemembered();
  try {
    // `auth: false` — the refresh cookie *is* the credential here. `remember` is restated because
    // the browser tells the server nothing about the lifetime of the cookie it presents.
    const data = await request(REFRESH_PATH, {
      method: 'POST',
      body: { remember },
      auth: false,
      keepReads: true,
    });
    if (!data?.accessToken) return null;
    persistTokens(data, remember);
    return data.accessToken;
  } catch (err) {
    // Only a *rejection* means the session is over; a `NetworkError` is a question the server never
    // answered, and signing out on it is the random-sign-out bug — docs/flows/consumer/auth.md.
    if (err instanceof NetworkError) throw fromRefresh(err);
    // Same reasoning one step further: a 429 or 5xx is the server declining to answer, not
    // answering "no". Only a 401 is the refusal.
    if (err instanceof ApiError && err.status !== 401) throw fromRefresh(err);
    return null;
  }
}

// Marks an error as the renewal's rather than the caller's, so a rate limit on `/auth/refresh` is
// not reported as one on saved properties. Only the message moves — docs/flows/consumer/auth.md.
function fromRefresh(err) {
  err.duringRefresh = true;
  err.message = `Could not renew your session — ${err.message}`;
  return err;
}

// Once, at cold boot; callers must have checked `sessionHinted()`. Why it is not folded into the
// 401 path: docs/flows/consumer/auth.md
export function restoreSession() {
  return refreshAccessToken();
}

// Preserves the tier the session lives in and demotes when localStorage is unwritable. Why the two
// questions must not be one boolean: docs/flows/consumer/auth.md
export function persistTokens({ accessToken }, remember) {
  const choice = remember ?? sessionRemembered();
  writeTokens({ accessToken }, choice && localStorageWritable());
}
