/**
 * The data seam's one boot-time await.
 *
 * `main.jsx` used to import `ensureMockDb` from `lib/mockApi.js` directly — the last mock import
 * left in product code. It is here instead because *which* store the app needs seeded, and whether
 * it needs one at all, is a question about the seam, not about the entry point. `main.jsx` should
 * only have to know that the seam has a readiness contract and that it must be awaited before the
 * first render.
 *
 * The seed is still unconditional. It looks like it should not be: every one of the 44 mock
 * providers is shadowed by an http provider in a live run (`playwright.live.config.js` enables 45
 * domains explicitly), so no mock provider is reachable and `config.js` already knows that
 * synchronously from its `registries` keys. But a provider is not the only way into the store —
 * `pages/consumer/services/rent-agreement/useRentAgreement.js` imports `createServiceRequest` from
 * `lib/mockApi.js` *directly*, below the seam, and that opens with `rawLoad()`, which throws rather
 * than returning empty when the store is missing. Skipping the seed in http mode would take the
 * three live rent-agreement specs down with it. Retire those two imports and the guard here becomes
 * a one-liner; until then, an unconditional seed is the correct behaviour, not a leftover.
 *
 * Dynamic `import()` rather than a static one so that guard has somewhere to go: the day the seed
 * becomes conditional, the mock store's module graph stops being fetched at all in a live build.
 * It costs nothing today — the caller is already awaiting `db.json` through a lazy chunk of its own
 * (D129), so this hop sits inside an await that existed anyway, and it resolves without a fetch on
 * every visit after the first.
 */
export async function ensureServicesReady() {
  const { ensureMockDb } = await import('../lib/mockApi.js');
  await ensureMockDb();
}
