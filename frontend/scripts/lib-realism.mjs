/* Pure helpers that make seeded listings internally consistent: the BHK, the
   built-up area and the price should agree with each other and with the
   property type. Shared by the one-off db.json patcher (fix-seed-realism.mjs)
   and by the seed generator so future regenerations stay realistic.

   Everything here is deterministic — a listing id maps to the same "jitter" every
   run — so repeated patches are idempotent and diffs stay stable. */

export const LAND_TYPES = ['Open Plot', 'Plot', 'Farm Land'];
export const COMMERCIAL_TYPES = [
  'Office Space', 'Shop / Showroom', 'Retail / Mall Unit',
  'Warehouse / Godown', 'Industrial / Factory', 'Co-working Space',
];
// Built-up homes whose type implies a larger, multi-bedroom layout.
export const PREMIUM_TYPES = ['Villa', 'Penthouse', 'Row House', 'Independent House'];

export const isLand = (type) => LAND_TYPES.includes(type);
export const isCommercial = (type) => COMMERCIAL_TYPES.includes(type);
export const isStudio = (type) => type === 'Studio';
export const isPremium = (type) => PREMIUM_TYPES.includes(type);
export const isResidential = (type) => !isLand(type) && !isCommercial(type);

// Realistic built-up area bands (sq.ft.) by bedroom count for a standard flat.
const FLAT_BANDS = { 0: [320, 520], 1: [450, 700], 2: [700, 1150], 3: [1150, 1750], 4: [1750, 2700], 5: [2500, 3400] };
// Premium homes are roomier for the same bedroom count.
const PREMIUM_BANDS = {
  Villa: { 3: [1800, 2600], 4: [2400, 3600], 5: [3200, 4500] },
  Penthouse: { 3: [1700, 2400], 4: [2300, 3200], 5: [3000, 4200] },
  'Row House': { 3: [1500, 2100], 4: [2000, 2800], 5: [2600, 3400] },
  'Independent House': { 3: [1400, 2200], 4: [2000, 3000], 5: [2800, 3800] },
};

// Stable 0..1 pseudo-random value derived from a listing id (deterministic).
export function jitter(id) {
  let h = 2166136261;
  for (let i = 0; i < String(id).length; i += 1) {
    h ^= String(id).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function bhkLabel(bhkNum, type) {
  if (bhkNum <= 0) return isStudio(type) ? 'Studio' : '1 RK';
  return `${bhkNum} BHK`;
}

// The bedroom count a listing *should* have, given its type and current value.
export function canonicalBhkNum(type, currentBhkNum) {
  if (isLand(type) || isCommercial(type)) return 0;
  if (isStudio(type)) return 0;
  if (isPremium(type)) return Math.max(3, Number(currentBhkNum) || 0);
  const n = Number(currentBhkNum) || 0;
  return n < 1 ? 1 : n; // a standard flat has at least 1 bedroom
}

function bandFor(type, bhkNum) {
  if (isPremium(type)) {
    const table = PREMIUM_BANDS[type] || PREMIUM_BANDS.Villa;
    return table[bhkNum] || table[3];
  }
  return FLAT_BANDS[bhkNum] || FLAT_BANDS[2];
}

// Keep the given area if it already fits the band; otherwise land it inside the
// band at a stable position so seed data stays varied but believable.
export function areaForBhk(type, bhkNum, currentArea, id) {
  const [lo, hi] = bandFor(type, bhkNum);
  const a = Number(currentArea) || 0;
  if (a >= lo && a <= hi) return a;
  return Math.round(lo + jitter(id) * (hi - lo));
}

// Buy price ≈ built-up area × locality rate, rounded to a clean figure.
export function buyPrice(area, ratePerSqft) {
  const raw = area * ratePerSqft;
  return Math.max(1500000, Math.round(raw / 50000) * 50000);
}

// Monthly rent ≈ a small fraction of capital value, rounded to ₹500 and kept in
// a sane band so nothing reads as absurd.
export function rentPrice(area, ratePerSqft, id) {
  const factor = 0.0031 + jitter(id) * 0.0007; // ~0.31%–0.38% of capital value / mo
  const raw = area * ratePerSqft * factor;
  const rounded = Math.round(raw / 500) * 500;
  return Math.min(200000, Math.max(7000, rounded));
}
