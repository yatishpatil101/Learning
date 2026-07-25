/**
 * Service layer configuration.
 *
 * Reads VITE_API_MODE from environment:
 *   - "mock" (default) → uses localStorage providers (current implementation)
 *   - "http" → uses real REST API providers (future Spring Boot backend)
 *
 * Components import from service modules (e.g., `services/propertyService.js`),
 * which internally delegate to the active provider. Swapping mock↔http requires
 * zero component changes — only this env variable.
 */

const API_MODE = import.meta.env.VITE_API_MODE || 'mock';

/** Base URL for HTTP provider (ignored in mock mode) */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api';

/** Whether we're using the mock (localStorage) backend */
export const isMock = API_MODE === 'mock';

/** Whether we're using the real HTTP backend */
export const isHttp = API_MODE === 'http';

/**
 * Lazily load and cache a provider module.
 * Each domain has a mock and http provider file.
 *
 * Usage inside a service module:
 *   const provider = createProvider('property');
 *   export const listProperties = (...args) => provider().listProperties(...args);
 */
const cache = new Map();

export function createProvider(domain) {
  return () => {
    if (cache.has(domain)) return cache.get(domain);

    // In mock mode, we eagerly import (they're sync localStorage wrappers).
    // Provider files export an object with all domain methods.
    let mod;
    if (isMock) {
      // Dynamic import isn't needed since mock providers are bundled with the app.
      // We use a registry pattern instead for synchronous access.
      mod = getMockProvider(domain);
    } else {
      mod = getHttpProvider(domain);
    }
    cache.set(domain, mod);
    return mod;
  };
}

// ─── Provider registries ───────────────────────────────────────────────────────
// These are populated by the barrel files in providers/mock/ and providers/http/

let mockProviders = null;
let httpProviders = null;

function getMockProvider(domain) {
  if (!mockProviders) {
    mockProviders = import.meta.glob('./providers/mock/*Provider.js', { eager: true });
  }
  const key = `./providers/mock/${domain}Provider.js`;
  const mod = mockProviders[key];
  if (!mod) throw new Error(`[services] No mock provider for domain "${domain}". Expected: ${key}`);
  return mod;
}

function getHttpProvider(domain) {
  if (!httpProviders) {
    httpProviders = import.meta.glob('./providers/http/*Provider.js', { eager: true });
  }
  const key = `./providers/http/${domain}Provider.js`;
  const mod = httpProviders[key];
  if (!mod) throw new Error(`[services] No HTTP provider for domain "${domain}". Expected: ${key}`);
  return mod;
}
