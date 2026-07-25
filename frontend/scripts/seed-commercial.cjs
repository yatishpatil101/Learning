/* One-off seed helper: appends commercial listings (one buy + one rent per
   commercial subtype) to src/data/db.json so the new "Commercial Type" filter
   has stock to browse. Idempotent — re-running strips previously seeded
   commercial rows (ids C6xxx) before re-adding. Run: node scripts/seed-commercial.js */
const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'src', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));

const owners = [
  { id: 'U1023', name: 'Rohan Kulkarni', mobile: '9530047855' },
  { id: 'U1035', name: 'Sneha Shah', mobile: '9124855617' },
  { id: 'U1030', name: 'Meera Deshpande', mobile: '9470744469' },
  { id: 'U1039', name: 'Tanvi Chavan', mobile: '9592138848' },
  { id: 'U1006', name: 'Meera Joshi', mobile: '9464709344' },
  { id: 'U1038', name: 'Tanvi Mehta', mobile: '9108512606' },
];

const loc = {
  baner: { name: 'Baner', lat: 18.559, lng: 73.787 },
  hinjawadi: { name: 'Hinjawadi', lat: 18.591, lng: 73.739 },
  kharadi: { name: 'Kharadi', lat: 18.551, lng: 73.943 },
  'viman-nagar': { name: 'Viman Nagar', lat: 18.566, lng: 73.914 },
  hadapsar: { name: 'Hadapsar', lat: 18.508, lng: 73.927 },
  magarpatta: { name: 'Magarpatta', lat: 18.518, lng: 73.927 },
  wakad: { name: 'Wakad', lat: 18.609, lng: 73.762 },
  aundh: { name: 'Aundh', lat: 18.558, lng: 73.807 },
  'koregaon-park': { name: 'Koregaon Park', lat: 18.538, lng: 73.893 },
  kothrud: { name: 'Kothrud', lat: 18.508, lng: 73.821 },
  balewadi: { name: 'Balewadi', lat: 18.575, lng: 73.775 },
  'pimple-saudagar': { name: 'Pimple Saudagar', lat: 18.598, lng: 73.803 },
};

const IMG = {
  office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70',
  shop: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70',
  retail: 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70',
  warehouse: 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70',
  industrial: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70',
  coworking: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70',
};
const IMG2 = {
  office: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=70',
  shop: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=70',
  retail: 'https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=800&q=70',
  warehouse: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=70',
  industrial: 'https://images.unsplash.com/photo-1565891741441-64926e441838?auto=format&fit=crop&w=800&q=70',
  coworking: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70',
};

/* [subtype label, buy locality, buy area/price, rent locality, rent area/price]
   Areas/prices are kept within the listings' default Buy area cap (6000 sq.ft)
   and default Rent price cap (₹1,00,000/mo) so every seeded unit is visible on
   first load without needing to widen the range sliders. */
const SPECS = [
  { key: 'office', label: 'Office Space',
    buy: { slug: 'baner', area: 1800, price: 22500000 }, rent: { slug: 'kharadi', area: 1200, price: 95000 } },
  { key: 'shop', label: 'Shop / Showroom',
    buy: { slug: 'kothrud', area: 650, price: 14500000 }, rent: { slug: 'viman-nagar', area: 800, price: 78000 } },
  { key: 'retail', label: 'Retail / Mall Unit',
    buy: { slug: 'koregaon-park', area: 1100, price: 31000000 }, rent: { slug: 'baner', area: 950, price: 98000 } },
  { key: 'warehouse', label: 'Warehouse / Godown',
    buy: { slug: 'hadapsar', area: 5200, price: 26000000 }, rent: { slug: 'wakad', area: 4200, price: 90000 } },
  { key: 'industrial', label: 'Industrial / Factory',
    buy: { slug: 'hinjawadi', area: 5800, price: 42000000 }, rent: { slug: 'pimple-saudagar', area: 6000, price: 99000 } },
  { key: 'coworking', label: 'Co-working Space',
    buy: { slug: 'aundh', area: 2400, price: 28000000 }, rent: { slug: 'magarpatta', area: 30, price: 12000 } },
];

const COMM_AMEN = ['parking', 'power', 'lift', 'security'];

function make(id, spec, deal, ownerIdx, dateIdx) {
  const d = deal === 'buy' ? spec.buy : spec.rent;
  const l = loc[d.slug];
  const owner = owners[ownerIdx % owners.length];
  const isRent = deal === 'rent';
  const priceStr = isRent ? `₹${d.price.toLocaleString('en-IN')}/mo` : `₹${d.price.toLocaleString('en-IN')}`;
  return {
    id,
    title: `${spec.label} in ${l.name}`,
    type: spec.label,
    bhk: '',
    bhkNum: 0,
    locality: l.name,
    localitySlug: d.slug,
    area: d.area,
    price: d.price,
    priceStr,
    deal,
    owner: owner.name,
    ownerId: owner.id,
    ownerMobile: owner.mobile,
    status: 'approved',
    featured: false,
    views: 180 + dateIdx * 37,
    enquiries: 4 + (dateIdx % 9),
    ownerVerified: dateIdx % 2 === 0,
    ownershipVerified: dateIdx % 3 === 0,
    furnishing: isRent ? 'semi' : 'unfurnished',
    construction: 'ready',
    rera: deal === 'buy',
    amenities: COMM_AMEN,
    image: IMG[spec.key],
    gallery: [IMG[spec.key], IMG2[spec.key], IMG[spec.key], IMG2[spec.key]],
    lat: l.lat + ((dateIdx % 5) - 2) * 0.004,
    lng: l.lng + ((dateIdx % 3) - 1) * 0.004,
    desc: `${spec.label} available on ${isRent ? 'lease' : 'sale'} in ${l.name}, Pune. Zero brokerage — deal directly with the verified owner.`,
    createdAt: `2026-0${5 + (dateIdx % 2)}-${String(3 + dateIdx).padStart(2, '0')}`,
    docsCount: 3 + (dateIdx % 3),
    flagReason: '',
  };
}

// Strip any previously-seeded commercial rows (C6xxx) so this is idempotent.
db.listings = db.listings.filter((p) => !/^C6\d+$/.test(p.id));

const fresh = [];
let n = 6100;
SPECS.forEach((spec, i) => {
  fresh.push(make('C' + n++, spec, 'buy', i, i));
  fresh.push(make('C' + n++, spec, 'rent', i + 3, i + 6));
});

db.listings.push(...fresh);
fs.writeFileSync(DB, JSON.stringify(db, null, 2) + '\n');
console.log('Seeded', fresh.length, 'commercial listings. Total listings:', db.listings.length);
