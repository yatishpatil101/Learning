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

/** True when `domain` should resolve to its http provider. */
export const isHttpDomain = (domain) => enabledDomains.has('*') || enabledDomains.has(domain);

/** True when no domain is live — i.e. the app is running fully on mocks. */
export const isFullyMocked = enabledDomains.size === 0;

/**
 * Lazily resolve and cache the active provider module for a domain.
 *
 *   const provider = createProvider('property');
 *   export const listProperties = (...args) => provider().listProperties(...args);
 */
const cache = new Map();

export function createProvider(domain) {
  return () => {
    if (cache.has(domain)) return cache.get(domain);

    let mod = isHttpDomain(domain) ? getProvider('http', domain) : null;
    if (!mod) {
      if (isHttpDomain(domain)) {
        // Opted in but nothing to opt into — almost always a typo in VITE_API_DOMAINS. Warn loudly,
        // but keep the app usable on mocks instead of throwing.
        console.warn(
          `[services] Domain "${domain}" is enabled in VITE_API_DOMAINS but has no http provider ` +
            `(expected ./providers/http/${domain}Provider.js). Falling back to the mock provider.`,
        );
      }
      mod = getProvider('mock', domain);
    }
    cache.set(domain, mod);
    return mod;
  };
}

// ─── Provider registries ──────────────────────────────────────────────────────────────────────
// Vite needs statically analysable glob patterns, hence two literal globs rather than one built
// from `kind`. `http` may legitimately be empty while the backend is still being built.

const registries = {
  mock: import.meta.glob('./providers/mock/*Provider.js', { eager: true }),
  http: import.meta.glob('./providers/http/*Provider.js', { eager: true }),
};

/** Returns the provider module, or null if that (kind, domain) pair doesn't exist. */
function getProvider(kind, domain) {
  const mod = registries[kind][`./providers/${kind}/${domain}Provider.js`];
  if (!mod && kind === 'mock') {
    throw new Error(`[services] No mock provider for domain "${domain}".`);
  }
  return mod ?? null;
}
