import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Read through the API, not the grid. `> 0` is not enough — an ignored parameter also returns rows,
 * so every case pins the match as a strict subset AND checks the rows carry what was asked for. */

const get = async (query) => {
  const res = await fetch(`${API}/properties?${query}`);
  expect(res.ok, `GET /properties?${query} answered ${res.status}`).toBe(true);
  return res.json();
};

/** Every match, not a page: `size` is clamped to 100 server-side and the catalogue is far smaller. */
const all = (query) => get(`size=100&${query}`);

const detail = async (slug) => {
  const res = await fetch(`${API}/properties/${slug}`);
  expect(res.ok, `GET /properties/${slug} answered ${res.status}`).toBe(true);
  return res.json();
};

/* Returning the whole catalogue is the signature of a parameter that never reached the query, and
 * it is a *passing* answer to every assertion phrased as "more than none". */
const expectNarrowed = async (query) => {
  const [match, whole] = await Promise.all([all(query), get('size=1')]);
  expect(match.totalElements, `${query} has no stock in the seed`).toBeGreaterThan(0);
  expect(match.totalElements, `${query} returned the whole catalogue, so the facet was ignored`)
    .toBeLessThan(whole.totalElements);
  // Every per-row loop below reads `content`, so a match spilling past the clamp would quietly
  // downgrade them to a spot-check while `totalElements` kept the test green.
  expect(match.content.length, `${query} matched more rows than one page can carry`)
    .toBe(match.totalElements);
  return match;
};

test.describe('every offered filter has stock behind it', () => {
  /* Farm Land was a buy-only chip: one approved row, none on rent. A buyer could reach the empty
     state by picking the chip the product had just offered them. */
  for (const deal of ['buy', 'rent']) {
    test(`the Farm Land chip returns ${deal} listings`, async () => {
      const match = await expectNarrowed(`deal=${deal}&types=farmland`);
      for (const row of match.content) {
        expect(row.deal).toBe(deal);
        expect(row.propertyType, `${row.slug} is not land`).toMatch(/farm\s?land/i);
      }
    });

    /* Land use is a separate column from the type: `landUseOf()` infers agricultural from `Farm
       Land` as a display fallback, so asserting against the column is what catches it being ignored. */
    test(`the Land use filter returns agricultural ${deal} listings`, async () => {
      const match = await expectNarrowed(`deal=${deal}&landUse=agricultural`);
      for (const row of match.content) {
        expect(row.landUse, `${row.slug} was returned by a zone filter it does not state`)
          .toBe('agricultural');
      }
    });
  }

  /* `PropertySummary` does not carry the registration id — the grid renders a badge, not a number —
     so the rows are re-read one by one to prove the filter selected on the column itself. */
  test('the RERA filter returns listings that carry a registration number', async () => {
    const match = await expectNarrowed('rera=true');

    const ids = await Promise.all(match.content.map(async (row) => (await detail(row.slug)).reraId));
    for (const [i, reraId] of ids.entries()) {
      expect(reraId, `${match.content[i].slug} matched rera=true with no registration number`)
        .toMatch(/^P\d{11}$/);
    }
  });

  /* Both societies hold two listings: one row is also what a filter collapsed to an id lookup
     returns, so two is what makes "the filter selects a building" the stronger claim. */
  for (const slug of ['palm-court-panchshil-undri', 'golden-springs-panchshil-baner']) {
    test(`the Societies filter returns the listings bound to ${slug}`, async () => {
      const match = await expectNarrowed(`societies=${slug}`);
      expect(match.totalElements, `${slug} holds one listing, which any single-row bug also returns`)
        .toBeGreaterThan(1);
      for (const row of match.content) {
        expect(row.societySlug, `${row.slug} is not bound to ${slug}`).toBe(slug);
      }
    });
  }
});
