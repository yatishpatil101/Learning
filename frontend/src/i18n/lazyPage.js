/* `lazy()` for a route, with its locale namespaces attached (D129).
 *
 * The route chunk and the strings it needs are fetched in *parallel* and the
 * component is not handed to React until both have landed. Two properties come
 * out of that, and both matter:
 *
 *   - No flash of untranslated content. React.lazy resolves after
 *     `addResourceBundle` has run, so the first render of the route already has
 *     every key. There is no window in which `property.title` can paint.
 *   - No extra latency. `Promise.all`, not `await` then `await` — the JSON
 *     request goes out at the same moment as the chunk request, and both are
 *     covered by the Suspense fallback the route already has (the shared
 *     spinner, or the page's own skeleton where it has one).
 *
 * Which namespaces a route needs is not guesswork and not maintained by hand
 * alone: `scripts/check-i18n-route-namespaces.mjs` walks the import graph and
 * fails the build if a route can reach a key it did not declare.
 *
 * Routes that only use the eager shell namespaces stay on plain `lazy()` — the
 * same check script proves they are entitled to.
 */
import { lazy } from 'react';

import { loadNamespaces } from './index.js';

/**
 * @param {() => Promise<{ default: import('react').ComponentType }>} loader
 * @param {...string} namespaces  locale namespaces (file names under locales/en/)
 */
export function lazyPage(loader, ...namespaces) {
  return lazy(() => Promise.all([loader(), loadNamespaces(namespaces)]).then(([mod]) => mod));
}
