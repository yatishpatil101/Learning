// @ts-check
/** Mints a society per test: a module-scoped `Set` is per worker, while seeded societies are database-global. */
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
