/* DevSeed — Test data seeding (Under Offer demo).
   Replicates the HTML dev-seed.html: seeds a demo owner + sample listings
   into localStorage so devs can try the Under Offer flow end to end. */

import { loginUser } from '../auth.js';
import { addListing, markUnderOffer, addUnderOfferParty, closeDeal, getListings, getDeals } from '../store.js';

export const OWNER = { name: 'Demo Owner', mobile: '9000012345', role: 'owner' };

const IMG = [
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=600&q=80',
  'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=600&q=80'
];

// Fixed IDs so re-seeding overwrites cleanly.
const SEED = [
  {
    id: 'DEMO-UO-RENT',
    title: '3 BHK Flat',
    loc: 'Skyline Heights, Wakad, Pune',
    price: '₹42,000/mo',
    deal: 'rent',
    bhk: '3',
    furnishing: 'semi',
    img: IMG[1],
    state: 'reserved',
    pets: 'yes',
    parties: [
      { name: 'Rahul Sharma', mobile: '9988776655', note: 'token expected Friday' },
      { name: 'Sneha Patil', note: 'wants weekend visit' }
    ]
  },
  {
    id: 'DEMO-UO-BUY',
    title: '2 BHK Flat',
    loc: 'Green Acres, Hinjawadi, Pune',
    price: '₹85 Lakh',
    deal: 'buy',
    bhk: '2',
    furnishing: 'unfurnished',
    img: IMG[2],
    state: 'reserved',
    parties: [{ name: 'Amit Joshi', mobile: '9870011223', note: 'loan pre-approved' }]
  },
  {
    id: 'DEMO-ACTIVE',
    title: '2 BHK Flat',
    loc: 'Sunridge, Baner, Pune',
    price: '₹28,000/mo',
    deal: 'rent',
    bhk: '2',
    furnishing: 'furnished',
    img: IMG[0],
    state: 'active',
    parties: [],
    pets: 'yes',
    food: 'veg'
  },
  {
    id: 'DEMO-SOLD',
    title: '4 BHK Villa',
    loc: 'Palm Grove, Koregaon Park, Pune',
    price: '₹2.4 Cr',
    deal: 'buy',
    bhk: '4',
    furnishing: 'furnished',
    img: IMG[3],
    state: 'closed',
    parties: []
  }
];

function digits(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

export function clearDemo() {
  const mob = digits(OWNER.mobile);
  localStorage.removeItem('puneNestListings:' + OWNER.mobile);
  localStorage.removeItem('puneNestDeals:' + mob);
  localStorage.removeItem('puneNestDealReq:' + mob);
}

export function seedNow() {
  // Login as demo owner
  loginUser(OWNER);
  clearDemo();

  const mob = digits(OWNER.mobile);

  // Add listings in reverse so the first SEED entry ends up on top (addListing unshifts)
  SEED.slice()
    .reverse()
    .forEach((s) => {
      addListing({
        id: s.id,
        title: s.title,
        loc: s.loc,
        price: s.price,
        deal: s.deal,
        bhk: s.bhk,
        furnishing: s.furnishing,
        deposit: s.deal === 'rent' ? '₹84,000' : '',
        pets: s.pets || '',
        food: s.food || '',
        status: 'Verified & Live',
        statusClass: 'pill-active',
        views: Math.floor(Math.random() * 200) + 20,
        enquiries: Math.floor(Math.random() * 12),
        img: s.img,
        createdAt: Date.now()
      });
    });

  // Mark under offer or closed
  SEED.forEach((s) => {
    const kind = s.deal === 'rent' ? 'rent' : 'buy';
    if (s.state === 'reserved') {
      markUnderOffer(mob, s.id, kind);
      (s.parties || []).forEach((p) => {
        addUnderOfferParty(mob, s.id, p);
      });
    } else if (s.state === 'closed') {
      closeDeal(mob, s.id, kind);
    }
  });

  return SEED.length;
}

export function getInventory() {
  const mob = digits(OWNER.mobile);
  const listings = getListings();
  const deals = getDeals(mob);

  return listings.map((l) => {
    const deal = deals[l.id];
    return {
      id: l.id,
      title: l.title,
      loc: l.loc,
      price: l.price,
      deal: l.deal,
      bhk: l.bhk,
      status: deal
        ? deal.status === 'reserved'
          ? 'Under Offer'
          : deal.status === 'closed'
          ? 'Sold/Closed'
          : 'Active'
        : 'Active',
      parties: deal && deal.parties ? deal.parties.length : 0
    };
  });
}
