export const emiOf = (price) => {
  const loan = price * 0.8;
  const r = 8.5 / 1200;
  const n = 240;
  const e = (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return '₹' + Math.round(e / 1000) + 'k/mo';
};

/* What used to be here and where it went, because this file was the browser's half of a search
   contract the database now states — and keeping a second copy beside the page is how the two
   halves drifted apart in the first place:

   - `typeMatch`, `matchBuyType`, `matchRentType`, `commercialTypeMatch`, `offersSharing`,
     `bhkMatch` → `lib/listings/facetMatch.js`. The share-awareness of the two type matchers
     survives as the `share_type` column (V100), so the server excludes a PG from the Flat chip
     rather than trusting the browser to.
   - `enrichRent`, `landUseOf`, `isLandListing` → `lib/listings/enrichRent.js`. Both providers have
     to produce the same view model, and a service reaching into a page directory to do that is
     backwards.

   What remains is presentation and navigation, which is what belongs beside a page. */

export const tenantLabel = (t) => {
  if (!t || !t.length) return '';
  const fam = t.includes('family');
  const bach = t.some((x) => x.startsWith('bachelor'));
  if (fam && bach) return 'Family / Bachelors';
  if (fam) return 'Family';
  if (t.includes('company')) return 'Company';
  return 'Bachelors';
};

/* Deep-link from the Flatmates filter into the dedicated Flatmates finder,
   carrying locality + gender preference (mirrors buildFlatmatesUrl in the HTML). */
export function flatmatesUrl(f, locName) {
  const params = new URLSearchParams({ view: 'move-in' });
  const slug = [...f.localities][0];
  if (slug && locName[slug]) params.set('loc', locName[slug]);
  const hasF = f.tenants.has('bachelor-female');
  const hasM = f.tenants.has('bachelor-male');
  if (hasF && !hasM) params.set('g', 'female');
  else if (hasM && !hasF) params.set('g', 'male');
  return '/flatmates?' + params.toString();
}

export function toggleSet(set, v) {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}
