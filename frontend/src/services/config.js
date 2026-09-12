/**
 * Service layer configuration — where the data comes from.
 *
 * **The live API is the only data source this application has.** There is no mock provider, no
 * per-domain allow-list and no environment variable that can route a domain anywhere else. That is
 * the point: for as long as the switch existed, "which backend am I actually talking to?" was a
 * question about a build, and a green test run was only evidence about whichever side of the switch
 * that run happened to be on.
 *
 * ### What used to be here, and why none of it survived
 *
 * Integration was incremental — the backend shipped one vertical slice at a time — so the switch
 * was per domain (`VITE_API_DOMAINS=auth,property`, `*` for all, unset for none) with
 * `VITE_API_MODE=http` as a legacy alias. Every one of the 44 mock providers now has an http twin,
 * so the allow-list had nothing left to withhold; what it still had was three ways to be wrong.
 * A domain omitted from the list served mocks silently. A domain misspelled in it served mocks
 * silently *and* passed the live e2e suite while doing so (D105, which is why a startup validation
 * stood at the bottom of this file). And a hand-maintained list in `playwright.config.js`
 * disagreed with the provider directory the whole time — `permissions` was absent from it, so the
 * one screen that resolved that domain hit the live-only throw below on every live run.
 *
 * None of those failures can be expressed any more. Deleting the switch did not fix them one at a
 * time; it removed the thing that made them possible.
 *
 * `VITE_API_BASE` remains, because *which* server is a legitimate deployment question. *Whether*
 * it is a server is not.
 */

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
 * Start the import of a domain's provider. Synchronous up to the `load()` call, so an unknown
 * domain still throws at the same moment it always did, rather than inside a promise nobody may be
 * watching.
 *
 * The rejection is re-wrapped because a chunk that fails to load is a failure mode the eager glob
 * could not have, and Vite's own message (`Failed to fetch dynamically imported module: …`) names
 * a hashed URL, not a domain. It also surfaces at whichever call site happened to be first, which
 * after a stale deploy is effectively arbitrary — so the domain has to be in the message or the
 * report is unreadable. The original is kept as `cause`.
 *
 * @returns {Promise<object>} the provider module
 */
function loadProvider(domain) {
  const load = registry[`./providers/http/${domain}Provider.js`];
  if (!load) {
    /* A missing provider used to be survivable: the domain fell back to its mock and logged a
       warning. There is nothing to fall back to now, so this throws — and that is the honest
       outcome. The alternative to a screen that fails loudly is not a working screen, it is a
       screen serving data from nowhere, which is the failure this whole migration exists to end. */
    throw new Error(
      `[services] No provider for domain "${domain}" `
        + `(expected ./providers/http/${domain}Provider.js). Known domains: ${KNOWN_DOMAINS.join(', ')}.`,
    );
  }
  return load().catch((err) => {
    throw new Error(`[services] could not load the "${domain}" provider.`, { cause: err });
  });
}

// ─── Provider registry ────────────────────────────────────────────────────────────────────────
// Vite needs a statically analysable glob pattern, hence a literal path rather than one built from
// a variable. There used to be two of these, one per `kind`; the mock half is gone with the mocks.
//
// **Lazy, and it must stay lazy.** The values are `() => import(...)` loaders, not modules. Adding
// `{ eager: true }` back reinstates the `http.js → config.js → providers → http.js` cycle and
// re-arms a blank-page bootstrap that no build or lint can see, so
// `scripts/check-provider-cycle.mjs` asserts this stays lazy.
//
// The keys are still available synchronously, which is what lets `loadProvider` reject an unknown
// domain *by name*, and name the alternatives, without evaluating a single provider.

const registry = import.meta.glob('./providers/http/*Provider.js');

/* Every domain that has a provider. Sole surviving purpose is the error message above.
 *
 * It used to serve a second one: validating `VITE_API_DOMAINS` at startup (D105), which threw in
 * dev and logged in a build. That check existed because a *misspelled* domain name produced no
 * warning anywhere — `createProvider('propery')` is never called, since no service asks for a
 * domain that does not exist, so the domain you meant stayed quietly on mocks and a live e2e run
 * passed while exercising the mock. With no allow-list to misspell and no mock to fall back to,
 * there is nothing left for it to catch: an unknown domain now reaches `loadProvider` and throws
 * there, at the call site that wanted it, naming both the domain and this list. */
const KNOWN_DOMAINS = Object.keys(registry)
  .map((path) => path.match(/\/([^/]+)Provider\.js$/)?.[1])
  .filter(Boolean)
  .sort();
