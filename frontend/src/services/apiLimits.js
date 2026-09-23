/**
 * Contract constants for the API seam — deliberately a **leaf**: this module imports nothing, and
 * should not start to. Read that as a strong default, not a style preference.
 *
 * A provider may read these values at module scope, and a dependency-free module is guaranteed to
 * be fully evaluated before any importer's body runs — under any graph, including one someone
 * reintroduces a cycle into. `config.js` globs providers lazily for the same reason, and
 * `scripts/check-provider-cycle.mjs` fails the build if the eager form comes back: an eager glob
 * closes `http.js` → `config.js` → provider → `http.js`, and a provider reading `MAX_PAGE_SIZE`
 * inside that loop hits its temporal dead zone and boots the app to an empty `<body>` on every
 * route. Vite resolves such a cycle happily; only a browser executes it, so lint, `check` and the
 * bundle-size gate all stay green while nothing renders.
 *
 * Scope: values that are facts about the **contract** (limits, ceilings, header names) and that a
 * provider may need before it makes a call. Anything that needs `fetch`, tokens or `API_BASE`
 * belongs in `http.js`.
 */

/**
 * The server's hard ceiling on `size` (`spring.data.web.pageable.max-page-size`).
 *
 * Asking for more is silently clamped, not rejected, so a client that asked for 500 and got 100
 * would believe it had read everything. That silence is the reason `unwrapFullPage` (in `http.js`)
 * measures truncation against `totalElements` rather than against this constant.
 */
export const MAX_PAGE_SIZE = 100;
