import { createdMs, freshnessState } from '../../../lib/freshness.js';
import { computeQualityScore } from '../../../lib/qualityScore.js';
import { societyForListing } from '../../../data/societies.js';
import { sectionVisible } from './filterRelevance.js';
import { matchRentType, matchBuyType, bhkMatch, commercialTypeMatch, offersSharing } from './matchers.js';
import { RANGE } from './filterState.js';
import { propLatLng } from './geo.js';

// Relevance ranking: promote the listings a buyer/tenant should trust and act on first —
// featured slots, verified owners/ownership + RERA, actively-managed (fresh) listings, and
// more complete listings (photos, description, amenities via the shared quality score).
const FRESH_WEIGHT = { active: 200, aging: 120, stale: 40, dormant: 0 };
const relevanceScore = (p) => {
  let s = 0;
  if (p.featured) s += 1000;
  if (p.ownerVerified) s += 250;
  if (p.ownershipVerified) s += 200;
  if (p.rera) s += 80;
  s += FRESH_WEIGHT[freshnessState(p)] || 0;
  s += computeQualityScore(p);
  return s;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// The full listings results pipeline: filter the loaded inventory by the (deferred) filter
// state, apply the active sort, and recover from the near-point vs. locality contradiction.
// Pure: given the same inputs it returns the same { list, relaxedNear }.
export function computeResults({ all, df, sort, urlQ, locNameBySlug, tr }) {
  const rel = (s) => sectionVisible(s, df.types); // hidden (irrelevant) filters must not narrow results
  // A range thumb parked at its default ceiling means "and above" (the "+" the
  // slider shows), so treat it as no upper bound — otherwise high-value listings
  // (e.g. commercial rents above the residential-friendly ceiling) are silently
  // hidden. A value typed below/above the ceiling stays a concrete cap.
  const openHi = (hi, ceil) => (hi === ceil ? Infinity : hi);
  // The full filter pipeline, parameterised by whether the locality constraint is
  // dropped. Dropping localities powers the "no exact matches — showing nearby"
  // relaxation when a locality + a near-point contradict (e.g. a home-search
  // landmark whose parent slug holds no stock while listings sit nearby).
  const compute = (dropLoc) => {
    let list = all.filter((p) => p.deal === df.deal && p.status === 'approved');
    if (urlQ) list = list.filter((p) => p.title.toLowerCase().includes(urlQ) || p.locality.toLowerCase().includes(urlQ) || p.localitySlug.includes(urlQ));
    if (df.deal === 'buy') list = list.filter((p) => p.price >= df.budget[0] && p.price <= openHi(df.budget[1], RANGE.budget[1]));
    else list = list.filter((p) => p.price >= df.rent[0] && p.price <= openHi(df.rent[1], RANGE.rent[1]));
    if (df.types.size) list = list.filter((p) => [...df.types].some((k) => (df.deal === 'rent' ? matchRentType(k, p) : matchBuyType(k, p))));
    if (df.types.has('commercial') && df.commercialTypes.size) list = list.filter((p) => [...df.commercialTypes].some((k) => commercialTypeMatch(k, p.type)));
    // Sharing (PG occupancy) is meaningful for both deals — a PG can be rented per
    // bed or its building sold — so it is applied outside the deal-specific blocks.
    if (df.sharing.size && rel('sharing')) list = list.filter((p) => offersSharing(p, df.sharing));
    if (df.landUse.size && rel('landUse')) list = list.filter((p) => p.landUse && df.landUse.has(p.landUse));
    if (df.bhk.size && rel('bhk')) list = list.filter((p) => [...df.bhk].some((k) => bhkMatch(k, p.bhkNum)));
    if (df.furnishing.size && rel('furnishing')) list = list.filter((p) => df.furnishing.has(p.furnishing));
    if (!dropLoc && df.localities.size) list = list.filter((p) => df.localities.has(p.localitySlug));
    if (df.societies.size) list = list.filter((p) => { const s = societyForListing(p); return s && df.societies.has(s.slug); });
    if (df.deal === 'buy') list = list.filter((p) => p.area >= df.area[0] && p.area <= openHi(df.area[1], RANGE.area[1]));
    if (df.amenities.size && rel('amenities')) list = list.filter((p) => { const s = new Set(p.amenities || []); return [...df.amenities].every((a) => s.has(a)); });
    if (df.verified.owner) list = list.filter((p) => p.ownerVerified);
    if (df.verified.ownership) list = list.filter((p) => p.ownershipVerified);
    if (df.verified.rera && rel('verifRera')) list = list.filter((p) => p.rera);
    if (df.verified.society && rel('verifSociety')) list = list.filter((p) => p.societyVerified);
    if (df.verified.conveyance && rel('verifSociety')) list = list.filter((p) => p.conveyanceDone);

    if (df.deal === 'buy') {
      if (df.avail && rel('availability')) list = list.filter((p) => (df.avail === 'ready' ? p.construction === 'ready' : p.construction !== 'ready'));
      if (df.constr.size && rel('construction')) list = list.filter((p) => df.constr.has(p.construction));
      if ((df.age[0] !== 0 || df.age[1] !== 25) && rel('age')) list = list.filter((p) => (p.ageYears ?? 0) >= df.age[0] && (p.ageYears ?? 0) <= openHi(df.age[1], RANGE.age[1]));
      if ((df.floor[0] !== 0 || df.floor[1] !== 40) && rel('floor')) list = list.filter((p) => (p.floor ?? 0) >= df.floor[0] && (p.floor ?? 0) <= openHi(df.floor[1], RANGE.floor[1]));
    }
    if (df.deal === 'rent') {
      if (df.room.size && rel('room')) list = list.filter((p) => p.room && df.room.has(p.room));
      if (df.tenants.size && rel('tenants')) list = list.filter((p) => (p.tenants || []).some((t) => df.tenants.has(t)));
      if (df.availFrom && rel('availFrom')) {
        list = list.filter((p) => {
          if (df.availFrom === 'now') return p.availableFrom === 'now';
          if (df.availFrom === '15') return ['now', '15'].includes(p.availableFrom);
          if (df.availFrom === '30') return ['now', '15', '30'].includes(p.availableFrom);
          return true;
        });
      }
      if (df.pets && rel('amenities')) list = list.filter((p) => p.pets);
      if ((df.age[0] !== 0 || df.age[1] !== 25) && rel('age')) list = list.filter((p) => (p.ageYears ?? 0) >= df.age[0] && (p.ageYears ?? 0) <= openHi(df.age[1], RANGE.age[1]));
      if ((df.floor[0] !== 0 || df.floor[1] !== 40) && rel('floor')) list = list.filter((p) => (p.floor ?? 0) >= df.floor[0] && (p.floor ?? 0) <= openHi(df.floor[1], RANGE.floor[1]));
    }

    if (df.near) {
      const [nearLat, nearLng] = df.near.split(',').map(Number);
      const radiusKm = df.nearMode === 'min' ? df.nearRadius * 0.4 : df.nearRadius;
      list = list.filter((p) => {
        const [pLat, pLng] = propLatLng(p);
        return haversineKm(nearLat, nearLng, pLat, pLng) <= radiusKm;
      });
    }

    list = list.slice();
    if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
    else if (sort === 'newest') list.sort((a, b) => createdMs(b.createdAt) - createdMs(a.createdAt));
    else list.sort((a, b) => relevanceScore(b) - relevanceScore(a) || createdMs(b.createdAt) - createdMs(a.createdAt));
    return list;
  };

  const primary = compute(false);
  // Recovery: a near-point + selected localities that contradict yield 0 results.
  // Rather than a cold empty page, relax the tighter locality constraint and show
  // listings near the point, with a banner explaining the swap. Only triggers on
  // the genuine contradiction (near set, localities set, primary empty, relaxed
  // non-empty) so ordinary searches are untouched.
  if (df.near && df.localities.size && primary.length === 0) {
    const relaxed = compute(true);
    if (relaxed.length) {
      const names = [...df.localities].map((s) => locNameBySlug[s] || s);
      return { list: relaxed, relaxedNear: { locNames: names, nearLabel: df.nearLabel || tr('listings.thePlace') } };
    }
  }
  return { list: primary, relaxedNear: null };
}
