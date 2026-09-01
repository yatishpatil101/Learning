/**
 * The data seam's one boot-time await.
 *
 * `main.jsx` used to import `ensureMockDb` from `lib/mockApi.js` directly — the last mock import
 * left in product code. It is here instead because *which* store the app needs seeded, and whether
 * it needs one at all, is a question about the seam, not about the entry point. `main.jsx` should
 * only have to know that the seam has a readiness contract and that it must be awaited before the
 * first render.
 *
 * The seed is still unconditional, and after D256 that is the *only* reason `lib/mockApi.js` and
 * `src/data/db.json` are still in the tree. The provider argument for it is gone: there are no mock
 * providers left — all 45 were deleted, `config.js` globs `providers/http/*Provider.js` alone, and
 * `VITE_API_DOMAINS` went with them in M1. What keeps the seed is the route that never went through
 * a provider: `pages/consumer/services/rent-agreement/useRentAgreement.js` imports
 * `createServiceRequest` from `lib/mockApi.js` *directly*, below the seam, and that opens with
 * `rawLoad()`, which throws rather than returning empty when the store is missing. `lib/serviceFlow.js`
 * is the only other such importer. Retire those two and this function, `lib/mockApi.js`, `lib/store*`
 * and `db.json` all go together; until then, an unconditional seed is the correct behaviour, not a
 * leftover. **Those two imports are now the whole exit condition** — worth stating plainly, because
 * the previous version of this comment justified the seed on grounds that had quietly stopped being
 * true, which is how a leftover survives a cleanup.
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
