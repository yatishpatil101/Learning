// @ts-check
/**
 * A society for one live test to write to, and nobody else.
 *
 * ## Why this exists as a helper rather than five copies of a `find()`
 *
 * Every live society spec used to open its own building the same way: read a page of
 * `GET /societies`, take the first `claimStatus === 'unclaimed'` row, and remember it in a
 * module-scoped `Set` so a later test in the same file would take the next one.
 *
 * That guard never guarded anything. A module-scoped `Set` is scoped to a **worker process**, and
 * Playwright re-imports the module in each one, so every worker starts with its own empty set while
 * the societies it is rationing are global to the database. Two tests in one file could take the
 * same seeded society, and five files could take all of them at once — the sets were per worker,
 * and the societies were not.
 *
 * The failure that surfaced it is the shape to remember: a residency test verified one resident,
 * asked the membership endpoint how many verified residents the society had, and was told three.
 * Nothing was wrong with the code under test. Two other tests were living in the same building.
 *
 * ## Why minting is the fix and not a bigger `Set`
 *
 * A shared registry across workers would need a file or a lock, and it would still be rationing a
 * fixed pool of seeded rows: the suite would start failing the day it grew past the seed. Minting
 * removes the contention rather than arbitrating it. `POST /societies` is a first-class consumer
 * route — a member adding a building Draazy does not have — so a test society is created the same
 * way a real one is, and arrives in exactly the state these specs want: unclaimed, so residency
 * decisions go through the ops queue rather than needing a committee the test has not created; and
 * empty, so a spec that counts rows before and after a removal is counting only its own.
 *
 * The row is public on arrival (`SecurityConfig` permits `GET /societies/{slug}` and its membership
 * child), which the anonymous-reader assertions in these files depend on.
 */
import { expect } from '@playwright/test';
import { API, authHeaders } from './liveAuth.js';

/**
 * How many societies this worker has minted, so two mints inside one millisecond differ.
 *
 * A collision would not merely flake: `SocietyMintService` answers **200** with the canonical row
 * when the name already matches one, instead of 201 with a new one — so two tests would quietly
 * share a building again, which is the entire bug this helper exists to remove. The `expect(201)`
 * below is therefore load-bearing, not ceremony.
 */
let sequence = 0;

/**
 * Mint a private society and hand back its slug.
 *
 * The `Zz` prefix keeps these rows at the end of any name-ordered listing, out of the way of specs
 * that assert on the first page of the directory. Wakad is a real seeded locality: an unknown one is
 * dropped rather than stored (`societies.locality_slug` is a foreign key), which would leave the
 * society unplaced and quietly change what the hub renders.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} author mobile of a signed-in account; recorded as the society's creator
 * @param {string} label short tag naming the calling spec, so a stray row in the database can be
 *   traced back to the file that made it
 * @returns {Promise<string>} the slug of a society nothing else is writing to
 */
export async function mintSociety(request, author, label) {
  sequence += 1;
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${sequence}`;
  const res = await request.post(`${API}/societies`, {
    headers: await authHeaders(author),
    data: {
      name: `Zz Live ${label} ${stamp}`,
      localityLabel: 'Wakad',
      localitySlug: 'wakad',
      lat: 18.5989,
      lng: 73.7629,
    },
  });
  // 200 means the name matched something that already existed — see `sequence` above.
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).slug;
}
