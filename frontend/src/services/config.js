/**
 * Service layer configuration. The live API is the only data source: no mock provider, no
 * per-domain allow-list, nothing that can route a domain anywhere but the server.
 */

/* Relative `/api` keeps requests same-origin, so CORS does not arise in dev and the page's
   `connect-src 'self'` is satisfied. An absolute URL targets a deployed backend directly. */
import { PROVIDER_LOAD_FAILED } from '../lib/seamErrors.js';

export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Warn, not throw: a cross-origin base is legitimate once CORS and CSP match, but in dev it is
// almost always a mistake whose only clue is a console entry behind a generic "login failed".
// Guarded on `window` because the parity harness loads this module under Vite's SSR loader.
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
 * Resolve and cache a domain's provider. Async because the glob is lazy, which is what keeps
 * `config.js → provider → http.js → config.js` out of the static graph.
 *
 * The cache holds the Promise so concurrent first calls share one import. A rejection is evicted,
 * which retries a throw from the module body — not a failed chunk fetch, which the host memoises.
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
 * Synchronous up to `load()`, so an unknown domain throws at the call site rather than inside a
 * promise nobody watches. The rejection is re-wrapped because Vite's own message names a hashed
 * URL, not a domain, and surfaces at whichever call site happened to be first.
 *
 * @returns {Promise<object>} the provider module
 */
function loadProvider(domain) {
  const load = registry[`./providers/http/${domain}Provider.js`];
  if (!load) {
    /* Throws rather than degrades: with no mock to fall back to, the alternative to a screen that
       fails loudly is a screen serving data from nowhere. */
    throw new Error(
      `[services] No provider for domain "${domain}" `
        + `(expected ./providers/http/${domain}Provider.js). Known domains: ${KNOWN_DOMAINS.join(', ')}.`,
    );
  }
  return load().catch((err) => {
    const failure = new Error(`[services] could not load the "${domain}" provider.`, { cause: err });
    /* A machine-readable code, because this message is a developer's and the screens above the
       seam have to say something else. The code says only that the module did not arrive. */
    failure.code = PROVIDER_LOAD_FAILED;
    throw failure;
  });
}

// ─── Provider registry ────────────────────────────────────────────────────────────────────────
// Must stay lazy: `{ eager: true }` reinstates the `http.js → config.js → providers → http.js`
// cycle and a blank-page bootstrap no build or lint can see. `check-provider-cycle.mjs` asserts it.

const registry = import.meta.glob('./providers/http/*Provider.js');

/* Keys are available synchronously even though the modules are not, which is what lets the throw
   above name the alternatives without evaluating a single provider. */
const KNOWN_DOMAINS = Object.keys(registry)
  .map((path) => path.match(/\/([^/]+)Provider\.js$/)?.[1])
  .filter(Boolean)
  .sort();
