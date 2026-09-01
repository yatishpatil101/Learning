/**
 * Mock locality provider — the localStorage counterpart to `providers/http/localityProvider.js`.
 *
 * Reads the seeded `localities` collection through the same getter the admin content console uses,
 * so the search filters and the console keep agreeing about which areas exist while both survive.
 *
 * ## Three deliberate differences, none of them papered over
 *
 * **`listingCount` comes from a stored `listings` field, and the server computes it.** That is the
 * whole of decision D7.2: a denormalised count that nothing recalculates goes stale the first time a
 * listing is approved or archived, and it had — three of fifteen were already wrong. The name is
 * translated here so the seam has one word for it, but the number is still the mock's number and
 * still capable of lying. Nothing renders it today.
 *
 * **`city` and the two per-sq-ft averages do not exist in the mock at all.** `city` is empty rather
 * than "Pune": guessing it here would be a fact invented in the provider layer, and the mock is
 * single-city by construction rather than by data. `avgRentPsf` and `avgBuyPsf` are `null`, which
 * the seam already means "not published" — the mock carries an absolute `avgRent` and a headline
 * `ratePerSqft` and has never held a per-sq-ft rent.
 *
 * **Every row is returned, including inactive ones.** The server filters `active = true` and this
 * cannot, because the mock's admin console toggles that flag and expects the change to be visible
 * to it. Filtering here would be the safer-looking choice and would quietly hide a row the console
 * had just published. The flag is passed through, so a caller that cares can see it.
 *
 * Order is `db.json` order. The server promises alphabetical; this does not, and sorting here would
 * imply the two agreed about more than they do.
 *
 * ## The curation queue mirrors the server's refusals, not just its happy path
 *
 * `getLocalityQueue` and `assignLocality` reproduce every 404 and 409 the endpoint raises. A mock
 * that implemented only the success case would let the console ship a screen that had never been
 * shown an error, and the first time an operator hit a retired locality in production the UI would
 * be discovering that failure mode for the first time.
 */
import { ApiError } from '../../http.js';
import { rawLoad, rawSave, delay } from '../../../lib/mockApi/core.js';
import { listLocalities as mockListLocalities } from '../../../lib/mockApi.js';

/** Every locality the mock knows about, in the server's vocabulary. */
export async function listLocalities() {
  const rows = await mockListLocalities();
  return (Array.isArray(rows) ? rows : []).map((l) => ({
    slug: String(l?.slug || ''),
    name: String(l?.name || ''),
    city: '',
    listingCount: Number(l?.listings) || 0,
    avgRentPsf: null,
    avgBuyPsf: null,
    ratePerSqft: l?.ratePerSqft == null ? null : Number(l.ratePerSqft),
    avgRent: l?.avgRent == null ? null : Number(l.avgRent),
    demand: l?.demand == null ? null : Number(l.demand),
    focus: String(l?.focus || ''),
    lat: l?.lat == null ? null : Number(l.lat),
    lng: l?.lng == null ? null : Number(l.lng),
    active: l?.active !== false,
  }));
}

/**
 * The three statuses whose locality anyone reads. `rejected`, `sold` and `deleted` listings are
 * excluded because nothing looks up their area — a queue padded with rows that cost nothing to
 * leave unfiled is a queue an operator learns to skim.
 */
const QUEUED = new Set(['pending', 'approved', 'flagged']);

/** Matches `LocalityQueueService.CAP`. Same number, same reason: one console page, bounded. */
const CAP = 200;

const toEntry = (l) => ({
  id: String(l?.id || ''),
  title: String(l?.title || ''),
  locality: l?.locality == null ? '' : String(l.locality),
  city: l?.city == null ? '' : String(l.city),
  lat: l?.lat == null ? null : Number(l.lat),
  lng: l?.lng == null ? null : Number(l.lng),
  status: String(l?.status || ''),
  localitySlug: l?.localitySlug ? String(l.localitySlug) : null,
  createdAt: l?.createdAt ? String(l.createdAt) : null,
});

/**
 * Listings the resolver could not place.
 *
 * Sorted approved-first, then oldest-first, matching the server. An approved listing with no
 * locality is already live and already missing from every locality surface — it is failing buyers
 * now, where a pending one is only about to — so it must not sink below a week of newer pending rows
 * in a capped list.
 */
export async function getLocalityQueue() {
  const rows = (rawLoad().listings || []).filter(
    (l) => !l?.localitySlug && !l?.archived && QUEUED.has(String(l?.status || '')),
  );
  const sorted = [...rows].sort((a, b) => {
    const rank = (l) => (l.status === 'approved' ? 0 : 1);
    return rank(a) - rank(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  // `total` is the honest backlog and `listings` is one screen of it. Returning the same number
  // twice would make the cap invisible, and past 200 the console's count would stop moving however
  // much work got done.
  return delay({ total: sorted.length, listings: sorted.slice(0, CAP).map(toEntry) });
}

/**
 * File one listing under an existing, active area.
 *
 * The retired-locality refusal is the one worth spelling out: filing a listing under an inactive
 * area moves it from "invisible because unfiled" to "invisible because filed somewhere unreachable"
 * — identical for the buyer, but now wearing a slug that makes the console look like the work was
 * done, which is strictly worse than the bug this queue exists to fix.
 */
export async function assignLocality(propertyId, slug) {
  const db = rawLoad();
  const listing = (db.listings || []).find((l) => l?.id === propertyId || l?.slug === propertyId);
  if (!listing) throw new ApiError({ code: 'not_found', status: 404, message: 'Listing not found' });
  if (listing.localitySlug) {
    throw new ApiError({
      code: 'conflict',
      status: 409,
      message: `That listing already has a locality ('${listing.localitySlug}'). Edit the listing to change it.`,
    });
  }
  const locality = (db.localities || []).find((l) => l?.slug === slug);
  if (!locality) throw new ApiError({ code: 'not_found', status: 404, message: 'Locality not found' });
  if (locality.active === false) {
    throw new ApiError({
      code: 'conflict',
      status: 409,
      message: `'${locality.name}' is retired, so a listing filed under it stays out of search and off its landing page. Reactivate it or pick another area.`,
    });
  }
  listing.localitySlug = locality.slug;
  rawSave(db);
  return delay(toEntry(listing));
}
