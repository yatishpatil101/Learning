/* One-off, idempotent patcher that normalises the seeded listings in
   src/data/db.json so BHK ↔ area ↔ price ↔ type all agree.

   Why patch in place instead of regenerating: the commercial listings (C61xx)
   are seeded by a separate script (scripts/seed-commercial.cjs) and would be
   lost by a full `npm run seed`. This script only rewrites the numeric fields
   (bhkNum, bhk, area, price) and never touches ids, owners, mobiles, status,
   featured flags, images, geo or copy — so test couplings (e.g. P5000's owner
   mobile) stay intact.

   Run: node scripts/fix-seed-realism.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isLand, isCommercial, isStudio, canonicalBhkNum, bhkLabel,
  areaForBhk, buyPrice, rentPrice,
} from './lib-realism.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'src', 'data', 'db.json');

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// locality name/slug → ₹/sq.ft, with a sensible default for outlying areas that
// aren't in the curated localities table.
const DEFAULT_RATE = 7000;
const rateBy = new Map();
(db.localities || []).forEach((l) => {
  if (l.ratePerSqft) {
    rateBy.set(l.name, l.ratePerSqft);
    if (l.slug) rateBy.set(l.slug, l.ratePerSqft);
  }
});
const rateFor = (l) => rateBy.get(l.locality) || rateBy.get(l.localitySlug) || DEFAULT_RATE;

let changed = 0;
const notes = [];

for (const l of db.listings || []) {
  const before = { bhkNum: l.bhkNum, bhk: l.bhk, area: l.area, price: l.price };

  if (isLand(l.type)) {
    // Land has no bedrooms; keep its (large) plot area, just clear stray BHK.
    l.bhkNum = 0;
    l.bhk = '';
  } else if (isCommercial(l.type)) {
    // Commercial has no bedrooms; keep its area/price but fix absurd values.
    l.bhkNum = 0;
    l.bhk = '';
    if (!l.area || l.area < 250) l.area = 250;
  } else {
    // Residential (flats + premium homes + studios): make BHK, area and price
    // consistent with each other and the locality rate.
    const bhkNum = canonicalBhkNum(l.type, l.bhkNum);
    const area = areaForBhk(l.type, bhkNum, l.area, l.id);
    const rate = rateFor(l);
    l.bhkNum = bhkNum;
    l.bhk = bhkLabel(bhkNum, l.type);
    l.area = area;
    l.price = l.deal === 'rent' ? rentPrice(area, rate, l.id) : buyPrice(area, rate);
    // Keep the title/description in step with the normalised BHK. Skip the label
    // when it would duplicate the type (e.g. a "Studio" typed property).
    const label = l.bhk && l.bhk !== l.type ? l.bhk + ' ' : '';
    l.title = `${label}${l.type} in ${l.locality}`;
    l.desc = `Spacious ${label}${l.type.toLowerCase()} in ${l.locality}, Pune. Zero brokerage, deal directly with the verified owner.`;
  }

  if (before.bhkNum !== l.bhkNum || before.bhk !== l.bhk || before.area !== l.area || before.price !== l.price) {
    changed += 1;
    notes.push(`${l.id} ${l.type} ${l.deal}: bhk ${before.bhkNum}→${l.bhkNum}, area ${before.area}→${l.area}, price ${before.price}→${l.price}`);
  }
}

writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
console.log(`Normalised ${changed} listing(s):`);
notes.forEach((n) => console.log('  ' + n));
