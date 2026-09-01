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
 */
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
