/**
 * Service layer configuration — which provider backs each domain.
 *
 * Integration is incremental: the backend ships one vertical slice at a time, so the switch is
 * **per domain**, not global. A single `mock`/`http` flag would force every domain to have a live
 * provider on the day the first one did, which is why this is an opt-in allow-list instead.
 *
 *   VITE_API_DOMAINS=auth            → auth talks to the real API, everything else stays on mocks
 *   VITE_API_DOMAINS=auth,property   → two domains live
 *   VITE_API_DOMAINS=*               → every domain that has an http provider goes live
 *   (unset)                          → all mocks (the default, and how the app is demoed with no
 *                                      backend running)
 *
 * `VITE_API_MODE=http` is honoured as a legacy alias for `*`.
 *
 * Mock mode must never break: a domain that is opted in but has no http provider falls back to its
 * mock and logs, rather than throwing and taking the whole app down over a typo.
 *
 * The one exception is a domain name that matches **nothing** — see the startup validation at the
 * bottom of this file. That is unambiguously a typo, and unlike the case above it produces no
 * warning anywhere, because nothing ever asks for a domain that does not exist.
 */

const RAW_DOMAINS = import.meta.env.VITE_API_DOMAINS || '';
const LEGACY_MODE = import.meta.env.VITE_API_MODE || 'mock';

/** Domains explicitly opted into the live API. */
const enabledDomains = new Set(
  RAW_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
);
if (LEGACY_MODE === 'http') enabledDomains.add('*');

/**
 * Base URL for the live API. Defaults to the relative `/api`, which the Vite dev proxy forwards to
 * the backend — a relative base keeps requests same-origin, so CORS simply doesn't arise in dev.
 * Override with an absolute URL to hit a deployed backend directly.
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// An absolute, cross-origin base bypasses the dev proxy, which reintroduces CORS *and* trips the
// page's `connect-src 'self'` CSP — the request is blocked before it leaves the browser, and the
// only clue is a console entry that is easy to miss behind a generic "login failed". Warn rather
// than throw: pointing a built bundle at a deployed API on another origin is legitimate, it just
// needs matching CORS and CSP.
// Guarded on `window` because this module is also loaded outside the browser — the parity harness
// drives the real providers under Vite's SSR loader, and a browser-only global here would make the
// service layer untestable anywhere but a page.
if (
  import.meta.env.DEV
  && typeof window !== 'undefined'
  && /^https?:\/\//.test(API_BASE)
  && !API_BASE.startsWith(window.location.origin)
) {
  console.warn(
    `[services] VITE_API_BASE="${API_BASE}" is cross-origin. In dev prefer the relative "/api", ` +
      'which the Vite proxy forwards to the backend, keeping requests same-origin (no CORS, and the ' +
      "page's connect-src 'self' CSP is satisfied).",
  );
}

/**
 * True when `domain` should resolve to its http provider.
 *
 * The allow-list is lower-cased when it is parsed, so the lookup key must be too — otherwise a
 * camelCase domain like `savedSearch` can never match, and (worse) it fails *silently*: the
 * "enabled but has no http provider" warning below is gated on this very function, so an opted-in
 * domain would quietly serve mocks with nothing in the console to say so.
 */
export const isHttpDomain = (domain) =>
  enabledDomains.has('*') || enabledDomains.has(String(domain).toLowerCase());

/** True when no domain is live — i.e. the app is running fully on mocks. */
export const isFullyMocked = enabledDomains.size === 0;

/**
 * Resolve and cache the active provider module for a domain. **Asynchronous** — see below.
 *
 *   const provider = createProvider('property');
 *   export const listProperties = async (...args) => (await provider()).listProperties(...args);
 *
 * ### Why this is async (D208)
 *
 * The glob below used to be `{ eager: true }`, which made `config.js` statically import all 58
 * providers, every one of which imports `services/http.js`, which imports `API_BASE` from *this*
 * module. That is a live import cycle: whenever a page reached `http.js` first, every provider was
 * evaluated *inside* `http.js`'s own evaluation, while `http.js`'s `export const` bindings were
 * still in their temporal dead zone. On 2026-08-11 two providers read `MAX_PAGE_SIZE` at module
 * scope and the entire app booted to an empty `<body>` on every route, with lint, build and the
 * bundle-size gate all green — a Vite build resolves a cycle happily; only a browser executes it.
 *
 * A lazy glob removes the cycle rather than defusing one instance of it: `config.js` no longer
 * imports a provider at all, so the static graph is a DAG (`*Service.js → config.js`, and
 * `providers/* → http.js → config.js`) and a provider body cannot run before `http.js` has
 * finished. The cost is that resolution is now a dynamic `import()`, i.e. a Promise, and that is
 * what every service export awaits. Callers above the seam are unaffected: service functions have
 * always returned Promises (`services/index.js` states it as the seam's invariant), so awaiting
 * one more tick changes no signature they can observe.
 *
 * The cache holds the *Promise*, not the module, so concurrent first calls share a single import.
 * A rejection is evicted rather than cached, which makes a *retryable* failure retryable — a throw
 * from inside the provider module's own evaluation. It does not rescue a failed chunk **fetch**:
 * the host's module map memoises that failure by specifier, so the retry resolves to the same
 * error without a network hop. Stale-deploy recovery is a reload, not a retry, and this cache
 * cannot provide it. Say so rather than let the eviction look like more insurance than it is.
 */
const cache = new Map();

export function createProvider(domain) {
  return () => {
    let pending = cache.get(domain);
    if (!pending) {
      pending = loadProvider(domain).catch((err) => {
        cache.delete(domain);
        throw err;
      });
      cache.set(domain, pending);
    }
    return pending;
  };
}

/**
 * Pick mock vs http and start the import. Synchronous up to the `load()` call, so an unknown
 * domain still throws — and an opted-in domain with no http provider still warns — at the same
 * moment they always did, rather than inside a promise nobody may be watching.
 *
 * The rejection is re-wrapped because a chunk that fails to load is a failure mode the eager glob
 * could not have, and Vite's own message (`Failed to fetch dynamically imported module: …`) names
 * a hashed URL, not a domain. It also surfaces at whichever call site happened to be first, which
 * after a stale deploy is effectively arbitrary — so the domain has to be in the message or the
 * report is unreadable. The original is kept as `cause`.
 *
 * @returns {Promise<object>} the selected provider module
 */
function loadProvider(domain) {
  let load = isHttpDomain(domain) ? getLoader('http', domain) : null;
  if (!load) {
    if (isHttpDomain(domain)) {
      // Opted in but nothing to opt into — almost always a typo in VITE_API_DOMAINS. Warn loudly,
      // but keep the app usable on mocks instead of throwing.
      console.warn(
        `[services] Domain "${domain}" is enabled in VITE_API_DOMAINS but has no http provider ` +
          `(expected ./providers/http/${domain}Provider.js). Falling back to the mock provider.`,
      );
    }
    load = getLoader('mock', domain);
  }
  return load().catch((err) => {
    throw new Error(`[services] could not load the "${domain}" provider.`, { cause: err });
  });
}

// ─── Provider registries ──────────────────────────────────────────────────────────────────────
// Vite needs statically analysable glob patterns, hence two literal globs rather than one built
// from `kind`. `http` may legitimately be empty while the backend is still being built.
//
// **Lazy, and it must stay lazy.** The values are `() => import(...)` loaders, not modules. Adding
// `{ eager: true }` back reinstates the `http.js → config.js → providers → http.js` cycle and
// re-arms a blank-page bootstrap that no build or lint can see, so
// `scripts/check-provider-cycle.mjs` asserts this stays lazy.
//
// The keys are still available synchronously, which is what lets `getLoader` reject an unknown
// domain, and the startup validation below enumerate every domain that exists, without evaluating
// a single provider.

const registries = {
  mock: import.meta.glob('./providers/mock/*Provider.js'),
  http: import.meta.glob('./providers/http/*Provider.js'),
};

/** Returns the provider module's loader, or null if that (kind, domain) pair doesn't exist. */
function getLoader(kind, domain) {
  const load = registries[kind][`./providers/${kind}/${domain}Provider.js`];
  if (!load && kind === 'mock') {
    /* A **live-only** domain lands here, and the message has to say so or the next reader spends an
       afternoon writing the mock provider that was deliberately not written. `ticket` is the case:
       the mock store knows three ticket statuses where the server knows five and assigns by display
       name where the server assigns by user id, so a mock would have to invent facts (D184). Screens
       for such a domain gate on `isHttpDomain(...)` and show why they are shut; reaching this line
       means one of them forgot to. */
    const liveOnly = Boolean(registries.http[`./providers/http/${domain}Provider.js`]);
    throw new Error(
      liveOnly
        ? `[services] Domain "${domain}" is live-only — it has an http provider and no mock one, on `
          + 'purpose. A screen reached it while the domain is not in VITE_API_DOMAINS; gate that '
          + `screen on isHttpDomain('${domain}') and tell the reader why it is unavailable.`
        : `[services] No mock provider for domain "${domain}".`,
    );
  }
  return load ?? null;
}

/* ─── Startup validation of VITE_API_DOMAINS (tech-debt D105) ─────────────────────────────────
 *
 * A domain exists if **either** registry has a provider for it. Most have both; a few have only an
 * http one, deliberately (see `getLoader`), and taking the mock registry as the complete list would
 * make every live-only domain look like a typo — and this check *throws in dev*, so the whole app
 * blank-pages on boot with a message accusing you of misspelling a name you spelled correctly. That
 * cost a live e2e run its seven tests on 2026-08-13, all of them reporting a missing login field.
 *
 * **Why a typo needs different handling from a missing http provider.** The warning inside
 * `createProvider` only fires when a *real* domain is opted in and has no http provider yet, which
 * is legitimate mid-integration and rightly falls back to the mock. A typo fires nothing at all:
 * `createProvider('propery')` is never called, because no service asks for a domain that does not
 * exist. So `VITE_API_DOMAINS=propery` leaves `property` quietly on mocks with an empty console —
 * and a live e2e run passes while exercising the mock, which is the failure D105 was raised for.
 * Being lazy is exactly what makes the existing warning miss it; this check runs at module load.
 *
 * **Why it throws in dev and only logs in a build.** Dev is where the typo is made and where the
 * e2e suite runs, so failing hard there costs one restart and removes the whole class of bug. In a
 * built bundle the same throw would take a deployed app down over a config string, which is a worse
 * outcome than serving one domain from mocks — so production gets a `console.error` it cannot
 * swallow instead. This is the one deliberate asymmetry in this file. */
const KNOWN_DOMAINS = new Set(
  [...Object.keys(registries.mock), ...Object.keys(registries.http)]
    .map((path) => path.match(/\/([^/]+)Provider\.js$/)?.[1]?.toLowerCase())
    .filter(Boolean),
);

const unknownDomains = [...enabledDomains].filter((d) => d !== '*' && !KNOWN_DOMAINS.has(d));
if (unknownDomains.length) {
  const many = unknownDomains.length > 1;
  const message =
    `[services] VITE_API_DOMAINS names ${many ? 'domains that do' : 'a domain that does'} not `
    + `exist: ${unknownDomains.map((d) => `"${d}"`).join(', ')}. `
    + `Nothing is served live for ${many ? 'them' : 'it'}, and the domain you meant stays on mocks `
    + 'with no other warning — so a test run would pass while exercising the mock. '
    + `Known domains: ${[...KNOWN_DOMAINS].sort().join(', ')}.`;
  if (import.meta.env.DEV) throw new Error(message);
  console.error(message);
}
