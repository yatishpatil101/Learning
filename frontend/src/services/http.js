/**
 * HTTP client for the live Draazy API.
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
 *  - report every request's *reachability* to whoever is listening (see {@link observeReachability})
 */
import { API_BASE } from './config.js';
import {
  localStorageWritable, logoutUser, readAccessToken, sessionRemembered, writeTokens,
} from '../lib/auth.js';

const TRACE_HEADER = 'X-Trace-Id';
const REFRESH_PATH = '/auth/refresh';
/** Name of the cross-tab Web Lock that serialises token refreshes. */
const REFRESH_LOCK = 'draazy:auth-refresh';

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

/** The single reachability listener, or null when nobody is watching. @see observeReachability */
let reachabilityObserver = null;

/**
 * Watch whether requests are reaching the server (D166).
 *
 * Every provider in the app funnels through {@link send}, so this is the one place that sees all
 * of them — which is why the connectivity nudge lives here rather than at each call site. Before
 * this, only the two surfaces that happened to use `useAsyncList` fed the store, so a dropped
 * connection was announced on the vault and silently swallowed everywhere else.
 *
 * The observer is called **once per HTTP attempt** with the {@link NetworkError} that the attempt
 * is about to throw, or `null` when the server answered. "Answered" deliberately includes a 500 or
 * a 422: the request arrived, so it is not a connectivity fact and must never be captioned as one.
 * Classifying it is the listener's job, not ours — passing the error rather than a boolean keeps
 * the one definition of "unreachable" in `hooks/useConnectivity.js`, so the banner and any list
 * error can never disagree about what happened.
 *
 * A 401-recovered call reports twice (the original attempt and the replay). That is correct rather
 * than tolerated: both really were attempts, and the store they feed is a latch — repeating a
 * verdict it already holds costs nothing and cannot double-count anything.
 *
 * Deliberately an inversion rather than an `import` of the store: `services/` must not depend on
 * `hooks/`, and a cycle between these two modules (the store already imports {@link NetworkError})
 * would be resolved only by class-hoisting luck.
 *
 * @param {((err: NetworkError|null) => void)|null} fn single listener; a second call replaces it
 */
export function observeReachability(fn) {
  reachabilityObserver = fn;
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
 * @param {boolean}[opts.withStatus=false] resolve to `{ data, status }` instead of the bare body.
 *                                        For the handful of endpoints where the *code* is part of
 *                                        the answer rather than a transport detail — `POST
 *                                        /societies` replies 201 for a society it minted and 200 for
 *                                        one that already existed, and the screen has to say "Added"
 *                                        or "Already on Draazy" accordingly. Errors still throw,
 *                                        so this never becomes a way to swallow a 4xx
 * @returns {Promise<any>} the parsed JSON body, or null for `204 No Content`
 */
export async function request(path, opts = {}) {
  const { auth = true, withStatus = false } = opts;
  const res = await send(path, opts, auth ? readAccessToken() : null);

  // An expired access token is the expected steady state, not an error: refresh and replay once.
  // Guarding on the path as well as `auth` keeps the recovery from ever being applied to the
  // refresh call itself — a 401 there means the session is over, and retrying it would both loop
  // and replay a single-use token.
  //
  // The final clause asks "did we think we had a session?". It cannot ask after the refresh token,
  // which is an HttpOnly cookie we are not allowed to see; the access token stands in for it,
  // because the two are written and cleared together. Being wrong is cheap in the only direction it
  // can be wrong — a stale access token with no cookie behind it costs one 401 on `/auth/refresh`.
  if (res.status === 401 && auth && path !== REFRESH_PATH && readAccessToken()) {
    const token = await refreshAccessToken();
    if (token) return toResult(await send(path, opts, token), withStatus);
    // Refresh failed → the session is genuinely gone. Clear it so guards stop believing otherwise.
    // "Genuinely" is doing real work: `refreshAccessToken` resolves null only when the server
    // actually refused, and throws when it could not be reached at all, so an unreachable server
    // never reaches this line. Signing someone out is destructive and irreversible from the
    // client — it must follow an answer, never the absence of one.
    logoutUser();
  }

  return toResult(res, withStatus);
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

/**
 * Re-exported so existing importers keep working; the value itself lives in `./apiLimits.js`.
 *
 * It moved out (D208) because `http.js` sits inside an import cycle — `http.js` → `config.js` →
 * every provider (eager glob) → `http.js` — so anything a provider reads at module scope from here
 * can land in a temporal dead zone and take the whole app down. `apiLimits.js` imports nothing, so
 * it is always fully evaluated first. **New provider code should import it from there, not here**;
 * `scripts/check-provider-cycle.mjs` enforces that. Read the header of `apiLimits.js` before
 * moving this back.
 */
export { MAX_PAGE_SIZE } from './apiLimits.js';

/**
 * Read a paged endpoint that the UI consumes as a plain list, and say so out loud when it overflows.
 *
 * Several collections are paged on the wire — because the *server* must not be asked to serialise
 * an unbounded result set (api-standards.md §5.1) — while the screen that reads them has no pager:
 * the dashboard filters and totals its deals client-side, the visits calendar groups by day. For
 * those, `?size=100` is the honest translation. It is not "paging turned off": the request is
 * bounded, the server does one indexed page-one scan, and the response cannot grow without limit.
 *
 * What it *is* is a ceiling, and a ceiling nobody is told about is how a list quietly starts lying.
 * `totalElements` counts the whole result set, so comparing it against the rows actually returned
 * detects both the overflow and the silent clamp above. The warning names the caller, because
 * "some list is truncated" is not something anyone can act on.
 *
 * A bare array is passed through unchanged: an endpoint that is deliberately unbounded server-side
 * (a capped or reference collection) is not truncated, and must not warn.
 *
 * `providers/http/conversationProvider.js` grew this pattern first and still carries its own copy:
 * its mapper takes the envelope rather than the rows, so folding it in here is a mapper change, not
 * a call swap. It is the reason this lives in `http.js` instead of being copied a third time.
 *
 * @param {object|Array} res    the parsed response body
 * @param {string} label        the domain to name in the warning, e.g. `'deal'`
 * @returns {unknown[]}         the rows, in server order
 */
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
    const res = await fetch(API_BASE + path + buildQuery(query), {
      method,
      headers,
      // The refresh token rides an HttpOnly cookie. Note what this flag does and does not do:
      // same-origin (the default `/api` deployment) `fetch` already sends cookies, because the
      // default is `credentials: 'same-origin'` — so there this line is a no-op, not the thing that
      // makes refresh work. It earns its place only in the cross-origin `VITE_API_BASE` deployment,
      // which the server permits explicitly via `Allow-Credentials` plus an origin allowlist
      // (`CorsConfig`). The flip side is worth knowing: with `include`, a misconfigured
      // `VITE_API_BASE` would send cookies to whatever host it names, which the default would not
      // have done. That is bounded here because `send` is the only fetch in the service layer and
      // can only ever build `API_BASE + path` — there is no absolute-URL call path, so no
      // third-party host is reachable from this line.
      credentials: 'include',
      body: body === undefined ? undefined : isFormData(body) ? body : JSON.stringify(body),
    });
    // The server answered — whatever its status, the connection is demonstrably working, so clear
    // any standing "can't reach" verdict. Reported here and not in `toResult`, because a 500 is
    // just as much proof of reachability as a 200.
    reachabilityObserver?.(null);
    return res;
  } catch (cause) {
    const err = new NetworkError(cause);
    reachabilityObserver?.(err);
    throw err;
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

async function toResult(res, withStatus = false) {
  const payload = await parseBody(res);
  if (res.ok) return withStatus ? { data: payload, status: res.status } : payload;
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
 * Refresh tokens are single-use, and the backend treats replay as theft: presenting an
 * already-rotated token revokes the entire token family for that user (see
 * `RefreshTokenService.rotate`). So a double-refresh doesn't just fail — it signs the user out of
 * every session they have. The server forgives a replay landing within a few seconds of the
 * rotation it lost to, precisely because a client can no longer inspect the token to elect a
 * winner; that is a safety net for a race, though, not a licence to run one.
 *
 * That needs two layers of protection:
 *  - `refreshInFlight` dedupes concurrent callers inside one tab (three requests 401-ing at once).
 *    This is a module-scoped variable, so it is *only* ever a within-tab guard — it cannot see
 *    another tab, by construction.
 *  - a Web Lock serialises tabs, which share one cookie jar and would otherwise each refresh
 *    independently. `navigator.locks` is native and purpose-built for exactly this, so it costs
 *    nothing over hand-rolling an election on BroadcastChannel.
 *
 * The second layer is load-bearing, not an optimisation, and it is worth knowing why before anyone
 * simplifies it away on the grounds that the server forgives the loser anyway. Forgiveness settles
 * who gets a session; it does not settle who wins the *cookie*. Both responses carry a `Set-Cookie`,
 * and the jar keeps whichever lands last. The graced tab's rotation revokes the token the winner's
 * response is still carrying, so if that response lands second the browser ends up holding a token
 * the server has already revoked. Nothing breaks then — the next refresh is inside the window — but
 * the next refresh is normally fifteen minutes later, by which point the grace window has closed and
 * that stale cookie reads as a replay and burns the family. The user is signed out of everything by
 * the race the window was supposed to make survivable. The server cannot fix this from its side
 * (`RefreshTokenService.rotate` documents the two candidate repairs and why both cost more than they
 * save), so not sending the second request is the fix. That is this lock.
 *
 * Be honest about how much the second layer covers, because the gap is not obvious. `navigator.locks`
 * is undefined in non-secure contexts — which includes a plain-http LAN dev host, the one setup
 * `application-dev.properties` turns off `Secure` for. There the lock degrades to running inline,
 * and two tabs 401-ing together really can both spend the same cookie. That is what the server's
 * grace window exists to absorb, but it is a safety net being landed on rather than one held in
 * reserve, so the degradation warns rather than passing silently.
 *
 * Whichever tab loses the race must *not* then refresh again, so we compare against what we entered
 * with — see `doRefresh`. The comparison is on the **access** token, because the refresh token is
 * now an HttpOnly cookie and unreadable from here. It is a good witness in the `localStorage` tier,
 * where tabs share storage. It is *not* one in the `sessionStorage` tier (`remember: false`), which
 * is per-tab: a duplicated tab can never observe the other's rotation, so there the comparison is a
 * no-op and the lock is the only thing doing any work.
 *
 * @returns {Promise<string|null>} the new access token, or null if the session is unrecoverable
 */
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    const entryToken = readAccessToken();
    refreshInFlight = exclusively(() => doRefresh(entryToken))
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * Run `fn` under a cross-tab lock where supported, falling back to plain execution.
 *
 * Both failure modes degrade to running inline rather than rejecting: an absent `navigator.locks`
 * (non-secure context) and a `request` that throws (`SecurityError` on an opaque or sandboxed
 * origin). Letting either propagate would send a raw `SecurityError` out through `request()`, past
 * the `ApiError`/`NetworkError` normalisation every caller branches on — turning a missing
 * optimisation into an unhandled error shape. The warn is the point: without it, the one
 * configuration where tabs can double-spend the cookie looks identical to the one where they cannot.
 */
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
  // Another tab rotated while we queued on the lock, or signed out entirely: either way the stored
  // token moved. Refreshing now would present the cookie that tab just replaced, which is what trips
  // reuse-detection. Hand back whatever is there — a token to retry with, or null to give up.
  //
  // `entryToken &&` is load-bearing, and the obvious "tidy-up" of bailing when it is null is a real
  // regression (caught by `live-flow.spec.js`, which logs out instead of renewing). A null access
  // token does **not** mean there is no session to renew: the credential this call spends is the
  // `HttpOnly` cookie, which we cannot see and which may well be valid. Entering with nothing is
  // exactly the cold-boot case where refreshing is the only way to find out, so the comparison must
  // stay a guard against a token that *moved*, not a precondition that one exists.
  if (entryToken && current !== entryToken) return current;
  // Resolved once, before the request, and reused for the write-back. Reading it twice would
  // straddle the response, whose own `Set-Cookie` lands before this promise resolves — so the
  // second read would be answering with the value the first read just caused.
  const remember = sessionRemembered();
  try {
    // `auth: false` — the refresh cookie *is* the credential here, and sending the dead access token
    // alongside it would just 401 again. `remember` is restated because the browser tells the server
    // nothing about the lifetime of the cookie it presents; without it every rotation would have to
    // guess, and a session the user declined to remember would quietly become a persistent one.
    const data = await request(REFRESH_PATH, {
      method: 'POST',
      body: { remember },
      auth: false,
    });
    if (!data?.accessToken) return null;
    persistTokens(data, remember);
    return data.accessToken;
  } catch (err) {
    // Only a *rejection* means the session is over. A `NetworkError` is not an answer — the server
    // never got to give one — and returning null here would let the caller sign the user out on the
    // strength of a question that was never asked.
    //
    // The case that proved this is not offline-with-a-dead-session, it is an in-flight refresh
    // cancelled by a navigation: `fetch` rejects with `AbortError`, `send` wraps it, and a session
    // that was fine a millisecond earlier gets cleared. Rare per-navigation, but the window is
    // exactly the moment a user clicks a link on an expired token, so it lands on real people and
    // reads as a random sign-out. It failed `live-flow.spec.js` only in the full suite, where load
    // widened the gap between the 401 and the reload; the spec alone passed every time.
    //
    // Rethrowing (rather than returning null) surfaces it as what it is: the caller's original call
    // fails with a `NetworkError` it already knows how to render, and the session is left intact for
    // the next attempt to renew.
    if (err instanceof NetworkError) throw fromRefresh(err);
    // Same reasoning, one step further: a 429 or a 5xx is the server declining to answer, not
    // answering "no". Only a 401 is the refusal. The distinction became consequential when the boot
    // path started calling `logoutUser()` on a null return, because that now deletes the session
    // hint — the one artifact that survives an ITP wipe. A refresh cookie with three weeks left
    // would still be in the jar and nothing would ever spend it again.
    //
    // Not a hypothetical: `/auth/refresh` is a mutating verb sent with `auth: false`, so the
    // server's write rate limit buckets it by IP with no principal to key on. Behind carrier-grade
    // NAT — the norm on Indian mobile networks — one noisy neighbour on the shared egress address
    // is enough to turn a recoverable session into a permanent sign-out.
    if (err instanceof ApiError && err.status !== 401) throw fromRefresh(err);
    return null;
  }
}

/**
 * Mark an error as having come from the renewal rather than from the call the user made.
 *
 * Both throws above hand the refresh's own failure to a caller that asked for something else
 * entirely, and the status travels with it. Unannotated, a saved-properties fetch reports "Too many
 * requests" for a rate limit the user never hit on saved properties, and a 503 from `/auth/refresh`
 * is read as the listings service being down. The status is worth keeping — it is what makes the
 * failure legible as transient and retryable, which is the whole reason these are thrown rather
 * than turned into a sign-out — so what is wrong is only the attribution, and attribution is what
 * this fixes. The alternative, returning the original 401 to the caller, is worse: the user is not
 * signed out, and telling a route guard that they are would act on a question the server declined
 * to answer.
 *
 * `code`, `status`, `fields` and `traceId` are untouched, so anything switching on them (the
 * documented way to branch, per {@link ApiError}) behaves exactly as before; only the human-facing
 * string moves. Annotated in place rather than copied because a copy loses the stack, and the stack
 * is the one thing that says where this actually came from.
 */
function fromRefresh(err) {
  err.duringRefresh = true;
  err.message = `Could not renew your session — ${err.message}`;
  return err;
}

/**
 * Try to turn a surviving refresh cookie back into a working session, once, at cold boot.
 *
 * Callers must have established that a session plausibly exists — `sessionHinted()` — because this
 * spends a request to find out. It exists as its own export rather than being folded into the
 * 401-recovery path in `request` for a reason: that path deliberately refuses to refresh when there
 * is no access token, since for every ordinary request an absent token means signed out, and
 * loosening it would make each anonymous page view retry through `/auth/refresh`. The cold boot is
 * the one moment where an absent token is genuinely ambiguous — Safari's ITP clears web storage
 * seven days in while leaving the server-set cookie alone — so the ambiguity is resolved here, once
 * per load, instead of being pushed into a gate that runs on everything.
 *
 * Shares `refreshInFlight` and the cross-tab lock with the 401 path, so a boot restore racing a
 * request-driven refresh cannot present the cookie twice and trip reuse-detection.
 *
 * @returns {Promise<string|null>} the new access token, or null if the session is genuinely over.
 *   Rejects with `NetworkError` when the server could not be reached — an unanswered question, not
 *   an answer, and the caller must not sign the user out on it.
 */
export function restoreSession() {
  return refreshAccessToken();
}

/**
 * Store the access token from an `AuthResponse`, preserving the tier the session already lives in so
 * a "remember this device" session isn't silently demoted to a tab-scoped one on refresh.
 *
 * Destructured rather than passed whole so an `AuthResponse` gaining a field never silently deposits
 * it in storage — and `refreshToken`, notably, is no longer one of them.
 *
 * `remember` is the user's *choice*; where the token can actually go is a second question, asked
 * here. `writeTokens` writes to `localStorage` when told to remember, swallows a failed `setItem`
 * and then purges `sessionStorage`, so a remembered token in a store that throws lands nowhere and
 * every page load churns a fresh rotation. Demoting the tier keeps the session alive locally and
 * leaves the server's 30-day cookie — and the hint recording the choice — untouched, which is
 * exactly why the two questions must not be one boolean.
 */
export function persistTokens({ accessToken }, remember) {
  const choice = remember ?? sessionRemembered();
  writeTokens({ accessToken }, choice && localStorageWritable());
}
