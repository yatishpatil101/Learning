/* Which English locale namespaces ship on the critical path (D129).
 *
 * `locales/en/*.json` is 253 KB raw across twenty files, and it used to be
 * bundled whole because English is the fallback for every user. That made the
 * entry chunk grow with every feature that added a string, no matter how well
 * the feature itself was code-split — `services.json` alone is 61 KB and is read
 * by one route family.
 *
 * The split is by *when the strings are needed*, not by size:
 *
 *   EAGER — anything that can paint before a route boundary resolves. The app
 *   chrome (`chrome`, `common`), the navbar's own strings (`misc1`), and the
 *   four pages App.jsx imports synchronously so they render with no Suspense at
 *   all: Home (`home`) and Signin/Signup/StaffLogin (`auth`).
 *
 *   Everything else — loaded by `lazyPage()` alongside the route chunk it
 *   belongs to, in parallel, behind the Suspense fallback that route already
 *   has. The route does not mount until its strings are in the store, so there
 *   is no window in which a translated label can paint as a raw key.
 *
 * `scripts/check-i18n-route-namespaces.mjs` enforces both halves against the
 * import graph, so this list cannot drift quietly.
 *
 * Plain data with no Vite-specific syntax on purpose: the build reads it and so
 * does the Node check script.
 */
export const EAGER_NAMESPACES = ['auth', 'chrome', 'common', 'help', 'home', 'misc1'];
