/* Instant valuation ("Rent-o-meter") — pure, deterministic estimator.
   Single-player owner tool: needs no buyer demand to deliver value. Uses the
   curated Pune locality intelligence (LOC: sale ₹/sq.ft + 2BHK rent benchmark)
   as its base and scales by BHK, area, and furnishing. Indicative only — the
   accurate path is the paid `/services/property-valuation` concierge report. */

import { LOC } from '../../data/localityIntel.js';

// City-wide fallbacks when a locality isn't in the curated set.
const CITY_PER_SQFT = 8500;
const CITY_RENT_2BHK = 24000;
const CITY_YOY = 8;

// Rent scales relative to the 2BHK benchmark (rent2).
const BHK_RENT_FACTOR = { 1: 0.62, 2: 1, 3: 1.42, 4: 1.85 };
// Typical carpet area (sq.ft) per BHK, used only when the owner leaves area blank.
const BHK_AREA = { 1: 550, 2: 900, 3: 1250, 4: 1700 };
// Furnishing nudges rent more than sale price.
const FURNISH_RENT = { unfurnished: 0.9, 'semi-furnished': 1.0, furnished: 1.15 };
const FURNISH_SALE = { unfurnished: 0.98, 'semi-furnished': 1.0, furnished: 1.04 };

const clampBhk = (bhk) => Math.min(4, Math.max(1, Number(bhk) || 2));
const roundTo = (n, step) => Math.round(n / step) * step;
const band = (mid, spread) => ({ low: Math.round(mid * (1 - spread)), mid, high: Math.round(mid * (1 + spread)) });

/**
 * Estimate monthly rent and sale value for a residential home.
 * @param {{locality?:string, bhk?:number|string, area?:number|string, furnishing?:string}} input
 * @returns {{known:boolean, locality:string, perSqft:number, yoy:number, area:number, bhk:number,
 *            rent:{low:number,mid:number,high:number}, sale:{low:number,mid:number,high:number}}}
 */
export function estimateValuation({ locality, bhk, area, furnishing } = {}) {
  const loc = (locality && LOC[locality]) || null;
  const perSqft = loc ? loc.price : CITY_PER_SQFT;
  const rent2 = loc ? loc.rent2 : CITY_RENT_2BHK;
  const yoy = loc ? loc.yoy : CITY_YOY;

  const b = clampBhk(bhk);
  const sqft = Math.max(150, Number(area) || BHK_AREA[b]);
  const furnRent = FURNISH_RENT[furnishing] ?? 1;
  const furnSale = FURNISH_SALE[furnishing] ?? 1;

  const rentMid = roundTo(rent2 * (BHK_RENT_FACTOR[b] || 1) * furnRent, 500);
  const saleMid = roundTo(perSqft * sqft * furnSale, 50000);

  // Wider band when the locality is unknown (lower confidence).
  const spread = loc ? 0.09 : 0.16;

  return {
    known: !!loc,
    locality: locality || 'Pune',
    perSqft,
    yoy,
    area: sqft,
    bhk: b,
    rent: band(rentMid, spread),
    sale: band(saleMid, spread),
  };
}

/** Localities we have curated benchmarks for (for the picker). */
export const VALUATION_LOCALITIES = Object.keys(LOC);
