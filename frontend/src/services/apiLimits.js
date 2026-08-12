/**
 * Contract constants for the API seam — deliberately a **leaf**: this module imports nothing, and
 * should not start to. Read that as a strong default, not a style preference.
 *
 * Why it exists (D208), and what changed. It was created on 2026-08-11 to escape a live import
 * cycle: `services/http.js` imported `API_BASE` from `services/config.js`, and `config.js` globbed
 * every provider **eagerly** —
 *
 *     mock: import.meta.glob('./providers/mock/*Provider.js', { eager: true }),
 *
 * — so `http.js` → `config.js` → every provider → `http.js` closed a loop. Whenever a page reached
 * `http.js` first, every provider was evaluated *inside* `http.js`'s own evaluation, while
 * `http.js`'s `export const` bindings were still in their temporal dead zone. Two providers read
 * `MAX_PAGE_SIZE` at module scope and the app booted to an empty `<body>` on every route —
 * `Cannot access 'MAX_PAGE_SIZE' before initialization` — from files the failing screens never
 * used. A Vite build resolved that cycle perfectly happily; only a browser executed it, which is
 * why lint, `check` and the bundle-size gate were all green while nothing rendered.
 *
 * **The cycle itself was removed on 2026-08-12**: that glob is now lazy, so `config.js` statically
 * imports no provider and the graph is a DAG. `scripts/check-provider-cycle.mjs` fails the build if
 * the eager form comes back. So this file is no longer the *only* thing standing between us and a
 * blank page, and the old warning that adding an import here "re-arms the crash" now overstates it.
 *
 * It stays anyway, and stays a leaf, for the reason that outlives the cycle: a provider may read
 * these values at module scope, and a dependency-free module is guaranteed to be fully evaluated
 * before any importer's body runs — under any future graph, including one someone reintroduces a
 * cycle into. Keeping it import-free costs nothing and keeps that guarantee unconditional; folding
 * it back into `http.js` trades it away for one fewer file.
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
