/* One-off seed helper: appends realistic approved 1 BHK & 2 BHK rental flats AND
   2 BHK / sub-1.5 Cr 3 BHK sale flats to src/data/db.json so the most common
   searches on BOTH deal tabs return stock. Mirrors scripts/seed-commercial.cjs —
   idempotent: re-running strips previously seeded rows (ids R71xx rent, R72xx buy)
   before re-adding, and never touches other listings.
   Run: node scripts/seed-rent-bhk.cjs

   Why a patcher (not `npm run seed`): commercial (C61xx) rows are appended by a
   separate script and would be lost by a full regenerate. This only adds R7xxx
   rows, so every existing id / owner / status coupling stays byte-for-byte intact.

   Gaps this closes (seed catalog was demo-thin on the highest-intent segments):
     - Rent: 0 one-BHK and 0 two-BHK approved flats → BHK=1/2 searches were empty.
     - Buy:  0 two-BHK approved flats, and only 1 three-BHK under ₹1.5 Cr city-wide
       (the smart-search placeholder's own example returned nothing).

   Note on the rental model: enrichRent() (src/pages/consumer/listings/matchers.js)
   deliberately re-tags very small rentals (bhkNum <= 1) as PG / flatmate shares so
   those filters have inventory; it does NOT touch Buy listings. 2 BHK rentals are
   preserved as normal flats, so the bulk of the rent stock targets the 2 BHK gap;
   1 BHK rows still populate the "1 BHK / Room" BHK filter count. */
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'src', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));

// Reuse real seeded owners so owner pages / mobiles stay consistent.
const owners = [
  { id: 'U1006', name: 'Meera Joshi', mobile: '9464709344' },
  { id: 'U1023', name: 'Rohan Kulkarni', mobile: '9530047855' },
  { id: 'U1030', name: 'Meera Deshpande', mobile: '9470744469' },
  { id: 'U1035', name: 'Sneha Shah', mobile: '9124855617' },
  { id: 'U1038', name: 'Tanvi Mehta', mobile: '9108512606' },
  { id: 'U1039', name: 'Tanvi Chavan', mobile: '9592138848' },
];

const loc = {
  baner: { name: 'Baner', lat: 18.559, lng: 73.787, rate: 9800 },
  wakad: { name: 'Wakad', lat: 18.609, lng: 73.762, rate: 8200 },
  hinjawadi: { name: 'Hinjawadi', lat: 18.591, lng: 73.739, rate: 7600 },
  kharadi: { name: 'Kharadi', lat: 18.551, lng: 73.943, rate: 9100 },
  'viman-nagar': { name: 'Viman Nagar', lat: 18.566, lng: 73.914, rate: 10400 },
  hadapsar: { name: 'Hadapsar', lat: 18.508, lng: 73.927, rate: 7300 },
  magarpatta: { name: 'Magarpatta', lat: 18.518, lng: 73.927, rate: 9600 },
  balewadi: { name: 'Balewadi', lat: 18.575, lng: 73.775, rate: 9000 },
  'pimple-saudagar': { name: 'Pimple Saudagar', lat: 18.598, lng: 73.803, rate: 8400 },
};

const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=70`;
// Residential interiors (same source family the generator uses).
const PHOTOS = [
  'photo-1522708323590-d24dbb6b0267', 'photo-1502672260266-1c1ef2d93688',
  'photo-1560448204-e02f11c3d0e2', 'photo-1493809842364-78817add7ffb',
  'photo-1484154218962-a197022b5858', 'photo-1522771739844-6a9f6d5f14af',
];
const gal = (i) => {
  const a = PHOTOS[i % PHOTOS.length];
  const b = PHOTOS[(i + 2) % PHOTOS.length];
  const c = PHOTOS[(i + 4) % PHOTOS.length];
  return [img(a), img(b), img(c), img(a)];
};

const AMEN_POOL = [
  ['lift', 'parking', 'security'],
  ['lift', 'parking', 'security', 'power'],
  ['parking', 'security', 'power', 'gym'],
  ['lift', 'parking', 'security', 'gym', 'pool'],
];

/* [bhkNum, area, rent/mo, locality slug, furnishing] — rents kept under the
   ₹1,00,000/mo default slider cap so every unit is visible on first load. */
const SPECS = [
  // 2 BHK flats — the #1 empty search; the bulk of the added stock.
  { bhk: 2, area: 920, price: 24000, slug: 'wakad', furn: 'semi' },
  { bhk: 2, area: 1050, price: 32000, slug: 'baner', furn: 'furnished' },
  { bhk: 2, area: 980, price: 27500, slug: 'hinjawadi', furn: 'semi' },
  { bhk: 2, area: 1100, price: 35000, slug: 'kharadi', furn: 'furnished' },
  { bhk: 2, area: 890, price: 21000, slug: 'hadapsar', furn: 'unfurnished' },
  { bhk: 2, area: 1020, price: 29500, slug: 'magarpatta', furn: 'semi' },
  { bhk: 2, area: 960, price: 26000, slug: 'balewadi', furn: 'semi' },
  { bhk: 2, area: 1080, price: 33000, slug: 'viman-nagar', furn: 'furnished' },
  { bhk: 2, area: 900, price: 22500, slug: 'pimple-saudagar', furn: 'unfurnished' },
  // 1 BHK flats — populate the "1 BHK / Room" filter count.
  { bhk: 1, area: 560, price: 16500, slug: 'hinjawadi', furn: 'semi' },
  { bhk: 1, area: 620, price: 19000, slug: 'baner', furn: 'furnished' },
  { bhk: 1, area: 540, price: 15000, slug: 'hadapsar', furn: 'unfurnished' },
];

function make(id, spec, i) {
  const l = loc[spec.slug];
  const owner = owners[i % owners.length];
  const label = spec.bhk === 1 ? '1 BHK' : '2 BHK';
  return {
    id,
    title: `${label} Flat in ${l.name}`,
    type: 'Flat',
    bhk: label,
    bhkNum: spec.bhk,
    locality: l.name,
    localitySlug: spec.slug,
    area: spec.area,
    price: spec.price,
    deal: 'rent',
    owner: owner.name,
    ownerId: owner.id,
    ownerMobile: owner.mobile,
    status: 'approved',
    featured: i % 5 === 0,
    views: 220 + i * 43,
    enquiries: 3 + (i % 11),
    ownerVerified: i % 3 !== 0,
    ownershipVerified: i % 2 === 0,
    furnishing: spec.furn,
    construction: 'ready',
    rera: false,
    amenities: AMEN_POOL[i % AMEN_POOL.length],
    image: gal(i)[0],
    gallery: gal(i),
    lat: l.lat + ((i % 5) - 2) * 0.004,
    lng: l.lng + ((i % 3) - 1) * 0.004,
    desc: `Well-maintained ${label.toLowerCase()} flat in ${l.name}, Pune. Zero brokerage — deal directly with the verified owner.`,
    createdAt: `2026-0${6 + (i % 2)}-${String(2 + i).padStart(2, '0')}`,
    docsCount: 2 + (i % 4),
    flagReason: '',
  };
}

/* [bhkNum, area, price, locality slug, furnishing, construction] — sale flats.
   Prices sit under the ₹5 Cr default budget slider and are set so at least one
   3 BHK in Baner lands below ₹1.5 Cr, making the smart-search placeholder example
   ("3 BHK under 1.5 Cr for sale in Baner, ready to move") return real stock. */
const BUY_SPECS = [
  // 2 BHK sale flats — this segment had zero approved stock.
  { bhk: 2, area: 1000, price: 9800000, slug: 'baner', furn: 'semi', constr: 'ready' },
  { bhk: 2, area: 950, price: 7800000, slug: 'wakad', furn: 'furnished', constr: 'ready' },
  { bhk: 2, area: 900, price: 6900000, slug: 'hinjawadi', furn: 'unfurnished', constr: 'under' },
  { bhk: 2, area: 1020, price: 9300000, slug: 'kharadi', furn: 'semi', constr: 'ready' },
  { bhk: 2, area: 880, price: 6400000, slug: 'hadapsar', furn: 'semi', constr: 'ready' },
  { bhk: 2, area: 1050, price: 10100000, slug: 'viman-nagar', furn: 'furnished', constr: 'new' },
  { bhk: 2, area: 960, price: 8600000, slug: 'balewadi', furn: 'semi', constr: 'ready' },
  // 3 BHK sale flats incl. a sub-1.5 Cr Baner unit for the placeholder example.
  { bhk: 3, area: 1450, price: 14200000, slug: 'baner', furn: 'semi', constr: 'ready' },
  { bhk: 3, area: 1350, price: 11800000, slug: 'wakad', furn: 'semi', constr: 'ready' },
  { bhk: 3, area: 1400, price: 10600000, slug: 'hinjawadi', furn: 'unfurnished', constr: 'ready' },
];

function makeBuy(id, spec, i) {
  const l = loc[spec.slug];
  const owner = owners[i % owners.length];
  const label = `${spec.bhk} BHK`;
  return {
    id,
    title: `${label} Flat in ${l.name}`,
    type: 'Flat',
    bhk: label,
    bhkNum: spec.bhk,
    locality: l.name,
    localitySlug: spec.slug,
    area: spec.area,
    price: spec.price,
    deal: 'buy',
    owner: owner.name,
    ownerId: owner.id,
    ownerMobile: owner.mobile,
    status: 'approved',
    featured: i % 4 === 0,
    views: 260 + i * 51,
    enquiries: 5 + (i % 9),
    ownerVerified: i % 3 !== 0,
    ownershipVerified: i % 2 === 0,
    furnishing: spec.furn,
    construction: spec.constr,
    rera: true,
    amenities: AMEN_POOL[(i + 1) % AMEN_POOL.length],
    image: gal(i + 3)[0],
    gallery: gal(i + 3),
    lat: l.lat + ((i % 5) - 2) * 0.004,
    lng: l.lng + ((i % 3) - 1) * 0.004,
    desc: `RERA-registered ${label.toLowerCase()} flat for sale in ${l.name}, Pune. Zero brokerage — deal directly with the verified owner.`,
    createdAt: `2026-0${5 + (i % 2)}-${String(4 + i).padStart(2, '0')}`,
    docsCount: 3 + (i % 4),
    flagReason: '',
  };
}

// Strip any previously-seeded rows (R71xx rent, R72xx buy) so this is idempotent.
db.listings = db.listings.filter((p) => !/^R7[12]\d+$/.test(p.id));

const rent = SPECS.map((spec, i) => make('R' + (7100 + i), spec, i));
const buy = BUY_SPECS.map((spec, i) => makeBuy('R' + (7200 + i), spec, i));
db.listings.push(...rent, ...buy);

fs.writeFileSync(DB, JSON.stringify(db, null, 2) + '\n');
const r2 = rent.filter((p) => p.bhkNum === 2).length;
const r1 = rent.filter((p) => p.bhkNum === 1).length;
const b2 = buy.filter((p) => p.bhkNum === 2).length;
const b3 = buy.filter((p) => p.bhkNum === 3).length;
console.log(`Seeded ${rent.length} rentals (${r2}× 2BHK, ${r1}× 1BHK) + ${buy.length} sale flats (${b2}× 2BHK, ${b3}× 3BHK). Total listings: ${db.listings.length}`);
