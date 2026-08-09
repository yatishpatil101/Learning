/**
 * HTTP client for the live PuneNest API.
 *
 * Deliberately built on native `fetch` — the only things a wrapper library would buy us here are
 * interceptors and error normalisation, both of which are ~40 lines against a single known backend.
 *
 * Responsibilities:
 *  - prefix `API_BASE`, send/parse JSON, attach `Authorization: Bearer`
 *  - normalise the backend's error envelope into a typed {@link ApiError} so callers never branch
 *    on raw status codes or guess at the body shape
 *  - transparently recover from an expired access token: 401 → refresh → retry once
 *  - surface the server's `X-Trace-Id` on every error so a UI report maps to a backend log line
 */
import { API_BASE } from './config.js';
import { logoutUser, readAccessToken, readRefreshToken, tokensRemembered, writeTokens } from '../lib/auth.js';

const TRACE_HEADER = 'X-Trace-Id';
const REFRESH_PATH = '/auth/refresh';
/** Name of the cross-tab Web Lock that serialises token refreshes. */
const REFRESH_LOCK = 'punenest:auth-refresh';

/**
 * A failed API call, normalised. `code` is the backend's stable machine-readable string (e.g.
 * `aadhaar_required`) — always prefer switching on it over `message`, which is human-facing and
 * may be reworded at any time.
 */
export class ApiError extends Error {
  constructor({ code, message, status, traceId, fields }) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.code = code || null;
    this.status = status;
    this.traceId = traceId || null;
    /** Field-level messages from a 422, as `[{ field, message }]`. Empty for other statuses. */
    this.fields = fields || [];
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

/**
 * Perform an API request.
 *
 * @param {string} path    path relative to the API base, e.g. `/auth/me`
 * @param {object} [opts]
 * @param {string} [opts.method='GET']
 * @param {any}    [opts.body]            serialised as JSON when present
 * @param {object} [opts.query]           appended as a query string; null/undefined entries dropped
 * @param {object} [opts.headers]         extra request headers, merged over the defaults. Used for
 *                                        the contract's `Idempotency-Key`; `Authorization` is not
 *                                        overridable here, since the session is not a per-call choice
 * @param {boolean}[opts.auth=true]       attach the bearer token and enable 401-refresh recovery
 * @returns {Promise<any>} the parsed JSON body, or null for `204 No Content`
 */
export async function request(path, opts = {}) {
  const { auth = true } = opts;
  const res = await send(path, opts, auth ? readAccessToken() : null);

  // An expired access token is the expected steady state, not an error: refresh and replay once.
  // Guarding on the path as well as `auth` keeps the recovery from ever being applied to the
  // refresh call itself — a 401 there means the session is over, and retrying it would both loop
  // and replay a single-use token.
  if (res.status === 401 && auth && path !== REFRESH_PATH && readRefreshToken()) {
    const token = await refreshAccessToken();
    if (token) return toResult(await send(path, opts, token));
    // Refresh failed → the session is genuinely gone. Clear it so guards stop believing otherwise.
    logoutUser();
  }

  return toResult(res);
}

export const get = (path, query, opts) => request(path, { ...opts, method: 'GET', query });
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
// PUT carries no body on the endpoints that use it so far (`/me/saved/{id}` is an idempotent
// set-membership write, where the URL is the whole request). `body` stays in the signature because
// a bodyless PUT is a property of those endpoints, not of the verb.
export const put = (path, body, opts) => request(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => request(path, { ...opts, method: 'DELETE' });

/**
 * POST a `multipart/form-data` body — the one content type the JSON path above cannot carry.
 *
 * The vault's file upload (`POST /me/documents/{propId}`) is the only endpoint that takes a binary
 * part, so this is deliberately a thin sibling of {@link post} rather than a body-type branch woven
 * through {@link request}: the JSON path stays the common case, unpolluted by a multipart check on
 * every call. `Content-Type` is intentionally *not* set — the platform derives it from the
 * `FormData`, including the boundary token, which a hand-set header would clobber.
 *
 * 401-refresh recovery and the {@link ApiError}/{@link NetworkError} normalisation are shared with
 * every other verb, because {@link request} sees the `FormData` and {@link send} leaves it untouched.
 *
 * @param {string}   path
 * @param {FormData} form
 * @param {object}   [opts]
 */
export const postMultipart = (path, form, opts) => request(path, { ...opts, method: 'POST', body: form });

/**
 * Read a `PageEnvelope` response into the shape the seam uses — one place to be wrong (D106).
 *
 * The wire shape is the Java record `PageResponse(content, page, size, totalElements, totalPages,
 * sort)`. Six providers unwrapped it by hand, in three subtly different ways, and four of them read
 * **`res.number`** — Spring's raw `Page` field, which this API does not send. The `?? page` fallback
 * behind it then resolved to the *requested* page, so the client agreed with the server right up
 * until the server disagreed: any clamp or redirect and the caller is told it is on a page it is
 * not on. Two parity harnesses unwrapped it wrongly in the same direction, which is exactly why the
 * bug went unreported — the check and the thing being checked were wrong together.
 *
 * `number` is still read, after `page` and never instead of it. It costs nothing and it is the
 * correct value when present; what was wrong was reaching past both to the requested page.
 *
 * @param {object|Array} res       the parsed response body, or a bare array from a legacy endpoint
 * @param {object} [requested]     `{ page, size }` as asked for, used only when the server omits them
 * @returns {{ items: unknown[], page: number, size: number, total: number, totalPages: number }}
 */
export function unwrapPage(res, requested = {}) {
  // A bare array is a legitimate response from the endpoints that are deliberately unpaged
  // (bounded reads, e.g. a property's reviews), so normalise rather than treating it as malformed.
  const items = Array.isArray(res) ? res : (res?.content ?? []);
  return {
    items,
    page: res?.page ?? res?.number ?? requested.page ?? 0,
    size: res?.size ?? requested.size ?? items.length,
    // `totalElements` counts the whole result set, not this page — the difference every "N results"
    // label and unread badge depends on. Falling back to `items.length` is only correct for the
    // unpaged case above, where the page IS the result set.
    total: res?.totalElements ?? items.length,
    totalPages: res?.totalPages ?? 0,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

/** True for a `multipart/form-data` body: the platform owns its `Content-Type` (boundary and all). */
const isFormData = (body) => typeof FormData !== 'undefined' && body instanceof FormData;

async function send(path, { method = 'GET', body, query, headers: extra }, token) {
  const headers = { Accept: 'application/json' };
  // JSON is the common case; a FormData body is serialised by the platform, which also sets the
  // Content-Type (with its boundary) — setting it here by hand would break the multipart parse.
  if (body !== undefined && !isFormData(body)) headers['Content-Type'] = 'application/json';
  // Caller headers are merged *before* Authorization, so a stray `Authorization` in `extra` cannot
  // displace the real session token — the one header that must never be a per-call decision.
  if (extra) Object.assign(headers, extra);
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers,
      body: body === undefined ? undefined : isFormData(body) ? body : JSON.stringify(body),
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }
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

async function toResult(res) {
  const payload = await parseBody(res);
  if (res.ok) return payload;
  throw new ApiError({
    code: payload?.error,
    message: payload?.message,
    status: res.status,
    // Prefer the body's traceId, but fall back to the header: 502s and other proxy-level failures
    // never reach our exception handler and so carry no envelope at all.
    traceId: payload?.traceId || res.headers.get(TRACE_HEADER),
    fields: payload?.fields,
  });
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

/**
 * Refresh the access token, coalescing concurrent callers **within and across tabs**.
 *
 * Refresh tokens are single-use *and* the backend treats replay as theft: presenting an
 * already-rotated token trips reuse-detection and revokes the entire token family for that user
 * (see `RefreshTokenService.rotate`). So a double-refresh doesn't just fail — it signs the user out
 * of every session they have.
 *
 * That needs two layers of protection:
 *  - `refreshInFlight` dedupes concurrent callers inside one tab (three requests 401-ing at once).
 *  - a Web Lock serialises tabs, which share the same `localStorage` token and would otherwise each
 *    refresh independently. `navigator.locks` is native and purpose-built for exactly this, so it
 *    costs nothing over hand-rolling an election on BroadcastChannel.
 *
 * Whichever tab loses the race must *not* then replay its stale token, so the token is re-read
 * inside the lock and compared against what we entered with — see `doRefresh`.
 *
 * @returns {Promise<string|null>} the new access token, or null if the session is unrecoverable
 */
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    const entryToken = readRefreshToken();
    refreshInFlight = exclusively(() => doRefresh(entryToken))
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** Run `fn` under a cross-tab lock where supported, falling back to plain execution. */
function exclusively(fn) {
  return navigator.locks ? navigator.locks.request(REFRESH_LOCK, fn) : fn();
}

async function doRefresh(entryToken) {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;
  // Another tab rotated while we queued on the lock: its new pair is already in storage. Replaying
  // `entryToken` here is precisely what would trip reuse-detection and kill every session.
  if (entryToken && refreshToken !== entryToken) return readAccessToken();
  try {
    // `auth: false` — the refresh token *is* the credential here, and sending the dead access token
    // alongside it would just 401 again.
    const data = await request(REFRESH_PATH, { method: 'POST', body: { refreshToken }, auth: false });
    if (!data?.accessToken) return null;
    persistTokens(data);
    return data.accessToken;
  } catch {
    return null;
  }
}

/**
 * Store the token pair from an `AuthResponse`, preserving the tier the session already lives in so
 * a "remember this device" session isn't silently demoted to a tab-scoped one on refresh.
 */
export function persistTokens({ accessToken, refreshToken }, remember) {
  writeTokens({ accessToken, refreshToken }, remember ?? tokensRemembered());
}
