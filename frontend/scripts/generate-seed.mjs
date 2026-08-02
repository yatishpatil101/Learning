/* PuneNest mock-data generator.
   Ports the deterministic seeded RNG from the prototype's admin-data.js and writes
   realistic test data to src/data/*.json. Run: npm run seed
   Single source of truth for all mock data — the future swap point is src/lib/mockApi.js. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLand, canonicalBhkNum, bhkLabel, areaForBhk, buyPrice, rentPrice,
} from './lib-realism.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data');
mkdirSync(OUT, { recursive: true });

// ---- deterministic RNG (same algorithm as prototype) ----
const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const intp = (r, a, b) => Math.floor(a + r() * (b - a + 1));
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const LOCALITIES = [
  ['Baner', 9800, 'Buy', 88, 18.559, 73.776], ['Wakad', 8200, 'Both', 90, 18.598, 73.762],
  ['Hinjawadi', 7600, 'Rent', 94, 18.591, 73.738], ['Kharadi', 9100, 'Both', 86, 18.551, 73.941],
  ['Viman Nagar', 10400, 'Both', 82, 18.567, 73.915], ['Koregaon Park', 14500, 'Buy', 70, 18.536, 73.893],
  ['Kothrud', 11200, 'Buy', 78, 18.507, 73.807], ['Hadapsar', 7300, 'Rent', 80, 18.500, 73.926],
  ['Aundh', 11800, 'Buy', 74, 18.558, 73.807], ['Magarpatta', 9600, 'Rent', 84, 18.516, 73.928],
  ['Pimple Saudagar', 8400, 'Both', 81, 18.598, 73.805], ['Bavdhan', 8800, 'Buy', 72, 18.514, 73.772],
  ['Balewadi', 9000, 'Both', 85, 18.575, 73.772], ['Undri', 6600, 'Buy', 68, 18.464, 73.917],
  ['NIBM Road', 8100, 'Buy', 71, 18.470, 73.901],
];
const FIRST = ['Aarav', 'Vivaan', 'Ananya', 'Diya', 'Rohan', 'Isha', 'Kabir', 'Sneha', 'Arjun', 'Meera', 'Vikram', 'Priya', 'Rahul', 'Neha', 'Siddharth', 'Pooja', 'Aditya', 'Riya', 'Karan', 'Tanvi', 'Nikhil', 'Sakshi', 'Omkar', 'Gauri'];
const LAST = ['Sharma', 'Patil', 'Deshpande', 'Joshi', 'Kulkarni', 'Mehta', 'Iyer', 'Nair', 'Gupta', 'Shah', 'Rao', 'Chavan', 'Bhosale', 'Jain', 'Reddy'];
const PTYPES = ['Flat', 'Villa', 'Row House', 'Penthouse', 'Plot', 'Studio'];
const BHKS = ['1 RK', '1 BHK', '2 BHK', '3 BHK', '4 BHK'];
const TEAMS = ['rental', 'legal', 'interior', 'packers', 'valuation'];
const TEAM_LABEL = { rental: 'Rent Agreement', legal: 'Property & Legal', interior: 'Interior & Renovation', packers: 'Packers & Movers', valuation: 'Property Valuation' };
const AMENITIES = ['gym', 'lift', 'parking', 'security', 'power', 'pool', 'garden', 'club', 'play'];
const PHOTOS = [
  'photo-1560448204-e02f11c3d0e2', 'photo-1568605114967-8130f3a36994', 'photo-1512917774080-9991f1c4c750',
  'photo-1600585154340-be6161a56a0c', 'photo-1600596542815-ffad4c1539a9', 'photo-1600607687939-ce8a6c25118c',
  'photo-1564013799919-ab600027ffc6', 'photo-1505691938895-1758d7feb511', 'photo-1502672260266-1c1ef2d93688',
];
const img = (id, w = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

const genName = (r) => pick(r, FIRST) + ' ' + pick(r, LAST);
// 9999xxxxxx is not allocated to any Indian subscriber, so seed owners rendered as
// live wa.me / tel: links on a public dev deploy can never reach a real person.
const genMobile = (r) => '9999' + intp(r, 100000, 999999);

function build() {
  const r = rng(20260618);
  const db = {
    users: [], listings: [], tickets: [], enquiries: [], visits: [], deals: [],
    localities: [], services: [], announcements: [], reviews: [], reports: [],
    referrals: [], faqs: [], banners: [], notifications: [], messages: [],
    plans: [], reels: [], auditLog: [], settings: {}, team: [],
  };

  LOCALITIES.forEach((l) => {
    db.localities.push({ name: l[0], slug: l[0].toLowerCase().replace(/\s+/g, '-'), ratePerSqft: l[1], demand: l[3], avgRent: Math.round(l[1] * 2.6), focus: l[2], lat: l[4], lng: l[5], listings: 0, active: true });
  });

  for (let i = 0; i < 46; i++) {
    const role = r() < 0.45 ? 'owner' : 'buyer';
    db.users.push({
      id: 'U' + (1000 + i), name: genName(r), mobile: genMobile(r), role,
      status: r() < 0.92 ? 'active' : 'suspended', verified: r() < 0.7,
      city: 'Pune', joinedAt: iso(daysAgo(intp(r, 1, 320))), listings: 0, lastActive: iso(daysAgo(intp(r, 0, 20))),
    });
  }
  TEAMS.forEach((t, idx) => {
    for (let k = 0; k < (idx % 2 ? 2 : 3); k++) {
      db.users.push({ id: 'S' + (200 + idx * 10 + k), name: genName(r), mobile: genMobile(r), role: 'staff', team: t, status: 'active', verified: true, city: 'Pune', joinedAt: iso(daysAgo(intp(r, 30, 300))), lastActive: iso(daysAgo(intp(r, 0, 5))) });
    }
  });
  db.users.push({ id: 'A001', name: 'Admin', mobile: '9000000000', role: 'admin', status: 'active', verified: true, city: 'Pune', joinedAt: iso(daysAgo(360)), lastActive: iso(new Date()) });

  const owners = db.users.filter((u) => u.role === 'owner');

  const statuses = ['pending', 'pending', 'approved', 'approved', 'approved', 'rejected', 'flagged'];
  for (let j = 0; j < 38; j++) {
    const loc = pick(r, db.localities);
    const owner = pick(r, owners);
    const deal = loc.focus === 'Rent' ? 'rent' : loc.focus === 'Buy' ? 'buy' : r() < 0.5 ? 'buy' : 'rent';
    const bhk = pick(r, BHKS);
    const area = intp(r, 450, 2400);
    const price = deal === 'rent' ? intp(r, 12, 65) * 1000 : Math.round(area * loc.ratePerSqft);
    const st = pick(r, statuses);
    const ptype = pick(r, PTYPES);
    // Post-process the drawn values so BHK ↔ area ↔ price ↔ type agree (shared
    // with the db.json patcher). This transforms already-drawn values only — it
    // consumes no RNG — so the deterministic seed order stays byte-for-byte stable.
    const id = 'P' + (5000 + j);
    let nBhkNum;
    let nArea;
    let nPrice;
    if (isLand(ptype)) {
      nBhkNum = 0;
      nArea = area; // land keeps its plot area
      nPrice = deal === 'rent' ? price : Math.round(area * loc.ratePerSqft);
    } else {
      nBhkNum = canonicalBhkNum(ptype, parseInt(bhk, 10) || 0);
      nArea = areaForBhk(ptype, nBhkNum, area, id);
      nPrice = deal === 'rent' ? rentPrice(nArea, loc.ratePerSqft, id) : buyPrice(nArea, loc.ratePerSqft);
    }
    const nBhk = bhkLabel(nBhkNum, ptype);
    // Skip the label when it would duplicate the type (e.g. a "Studio").
    const nLabel = nBhk && nBhk !== ptype ? nBhk + ' ' : '';
    owner.listings++;
    loc.listings++;
    const amen = AMENITIES.filter(() => r() < 0.5);
    const gallery = [pick(r, PHOTOS), pick(r, PHOTOS), pick(r, PHOTOS), pick(r, PHOTOS), pick(r, PHOTOS), pick(r, PHOTOS)].map((p) => img(p));
    db.listings.push({
      id, title: nLabel + ptype + ' in ' + loc.name, type: ptype,
      bhk: nBhk, bhkNum: nBhkNum, locality: loc.name, localitySlug: loc.slug, area: nArea, price: nPrice, deal,
      owner: owner.name, ownerId: owner.id, ownerMobile: owner.mobile,
      status: st, featured: r() < 0.18 && st === 'approved', views: intp(r, 20, 2400), enquiries: intp(r, 0, 60),
      ownerVerified: r() < 0.8, ownershipVerified: r() < 0.55,
      furnishing: pick(r, ['unfurnished', 'semi', 'furnished']), construction: pick(r, ['ready', 'new']),
      rera: r() < 0.6, amenities: amen, image: gallery[0], gallery,
      lat: loc.lat + (r() - 0.5) * 0.02, lng: loc.lng + (r() - 0.5) * 0.02,
      desc: 'Spacious ' + nLabel + ptype.toLowerCase() + ' in ' + loc.name + ', Pune. Zero brokerage, deal directly with the verified owner.',
      createdAt: iso(daysAgo(intp(r, 0, 90))), docsCount: intp(r, 1, 6),
      flagReason: st === 'flagged' ? pick(r, ['Suspected duplicate', 'Price looks off', 'User reported', 'Photos mismatch']) : '',
    });
  }

  const tstatus = ['new', 'new', 'in_progress', 'in_progress', 'done', 'done', 'cancelled'];
  const prio = ['low', 'medium', 'high'];
  for (let t = 0; t < 34; t++) {
    const team = pick(r, TEAMS);
    const cust = pick(r, db.users.filter((u) => u.role !== 'staff' && u.role !== 'admin'));
    const staffForTeam = db.users.filter((u) => u.role === 'staff' && u.team === team);
    const s = pick(r, tstatus);
    db.tickets.push({
      id: 'T' + (9000 + t), team, service: TEAM_LABEL[team], customer: cust.name, mobile: cust.mobile,
      status: s, priority: pick(r, prio), assignedTo: s === 'new' ? null : pick(r, staffForTeam).name,
      value: intp(r, 1, 25) * 1000, createdAt: iso(daysAgo(intp(r, 0, 40))),
      notes: s === 'new' ? [] : [{ at: iso(daysAgo(intp(r, 0, 5))), by: 'System', text: 'Request received and queued.' }],
      detail: pick(r, ['2 BHK, Wakad', '3 BHK, Baner', 'Office, Kharadi', '1 BHK, Hinjawadi', 'Villa, Aundh']),
    });
  }

  const approved = db.listings.filter((l) => l.status === 'approved');
  for (let e = 0; e < 60; e++) {
    const lst = pick(r, approved);
    const kind = r() < 0.6 ? 'contact' : 'visit';
    const rec = { id: 'E' + (7000 + e), listingId: lst.id, listing: lst.title, customer: genName(r), mobile: genMobile(r), kind, status: pick(r, ['new', 'responded', 'closed']), at: iso(daysAgo(intp(r, 0, 30))) };
    db.enquiries.push(rec);
    if (kind === 'visit') db.visits.push({ id: 'V' + (8000 + e), listingId: lst.id, listing: lst.title, customer: rec.customer, mobile: rec.mobile, when: iso(daysAgo(intp(r, -7, 5))), status: pick(r, ['scheduled', 'completed', 'cancelled']) });
  }
  for (let d = 0; d < 16; d++) {
    const dl = pick(r, approved);
    db.deals.push({ id: 'D' + (6000 + d), listingId: dl.id, listing: dl.title, deal: dl.deal, value: dl.price, status: pick(r, ['closed', 'closed', 'in_progress']), at: iso(daysAgo(intp(r, 0, 60))) });
  }

  db.services = [
    { key: 'rental', name: 'Rent Agreement', team: 'rental', price: 999, active: true, desc: 'Drafting, e-stamp & doorstep delivery.', icon: 'file-signature' },
    { key: 'legal', name: 'Property & Legal', team: 'legal', price: 2499, active: true, desc: 'Title check, registration support.', icon: 'scale' },
    { key: 'interior', name: 'Interior & Renovation', team: 'interior', price: 0, active: true, desc: 'Design consult to execution (quote-based).', icon: 'paint-roller' },
    { key: 'packers', name: 'Packers & Movers', team: 'packers', price: 0, active: true, desc: 'Verified movers (quote-based).', icon: 'truck' },
    { key: 'valuation', name: 'Property Valuation', team: 'valuation', price: 499, active: true, desc: 'Certified market valuation report.', icon: 'badge-indian-rupee' },
    { key: 'homeloan', name: 'Home Loans & EMI', team: 'legal', price: 0, active: true, desc: 'Loan facilitation with partner banks.', icon: 'landmark' },
  ];

  db.announcements = [
    { id: 'AN1', title: 'Zero brokerage week', body: 'Promote zero-brokerage across Baner & Wakad.', audience: 'All', at: iso(daysAgo(2)), active: true },
    { id: 'AN2', title: 'Monsoon move offer', body: '10% off Packers & Movers this month.', audience: 'Tenants', at: iso(daysAgo(9)), active: true },
  ];
  for (let rv = 0; rv < 12; rv++) db.reviews.push({ id: 'R' + (3000 + rv), user: genName(r), target: pick(r, ['Owner', 'Service: ' + pick(r, Object.values(TEAM_LABEL)), 'Locality: ' + pick(r, db.localities).name]), rating: intp(r, 3, 5), text: pick(r, ['Smooth experience, no broker hassle.', 'Verified docs, felt safe.', 'Quick response from the team.', 'Saved a lot on brokerage.']), status: pick(r, ['published', 'published', 'pending']), at: iso(daysAgo(intp(r, 0, 40))) });

  db.faqs = [
    { id: 'F1', q: 'Is PuneNest really zero brokerage?', a: 'Yes. You deal directly with verified owners — no brokerage, ever.', cat: 'General' },
    { id: 'F2', q: 'How are owners verified?', a: 'We verify owner identity (Aadhaar) and, where possible, ownership documents.', cat: 'Trust' },
    { id: 'F3', q: 'Can I list my property for free?', a: 'Basic listing is free. Paid plans add featured placement and more contacts.', cat: 'Owners' },
    { id: 'F4', q: 'Do you offer rent agreements?', a: 'Yes — drafting, e-stamp and doorstep delivery from ₹999.', cat: 'Services' },
  ];
  db.banners = [
    { id: 'B1', title: 'Zero Brokerage. Verified Owners.', cta: 'Browse listings', href: '/listings', active: true, theme: 'teal' },
    { id: 'B2', title: 'List your property free', cta: 'Post now', href: '/list-property', active: true, theme: 'indigo' },
  ];

  db.plans = [
    { id: 'PL1', name: 'Owner Basic', audience: 'owner', price: 0, period: 'forever', features: ['1 active listing', 'Verified owner badge', 'Limited contacts'], popular: false },
    { id: 'PL2', name: 'Owner Plus', audience: 'owner', price: 999, period: 'year', features: ['5 active listings', 'Featured for 7 days', 'Unlimited contacts', 'Priority support'], popular: true },
    { id: 'PL3', name: 'Owner Pro', audience: 'owner', price: 2499, period: 'year', features: ['Unlimited listings', 'Always featured', 'Dedicated manager', 'Free rent agreement'], popular: false },
    { id: 'PL4', name: 'Seeker Plus', audience: 'seeker', price: 199, period: 'one-time', features: ['Unlock 15 owner contacts', 'Priority visit slots', 'No spam guarantee'], popular: false },
  ];

  db.reels = approved.slice(0, 10).map((l, i) => ({
    id: 'RL' + (i + 1), listingId: l.id, title: l.title, locality: l.locality, price: l.price, deal: l.deal,
    poster: l.image, likes: intp(r, 30, 1200), views: intp(r, 200, 9000), tag: pick(r, ['Walkthrough', 'Owner tour', 'Drone view', 'Society tour']),
  }));

  // notifications + messages for a demo logged-in user
  db.notifications = [
    { id: 'N1', kind: 'visit', title: 'Visit confirmed', body: 'Your visit to 2 BHK in Baner is confirmed for tomorrow 5 PM.', at: iso(daysAgo(0)), read: false },
    { id: 'N2', kind: 'enquiry', title: 'Owner responded', body: 'The owner of 3 BHK in Wakad replied to your enquiry.', at: iso(daysAgo(1)), read: false },
    { id: 'N3', kind: 'price', title: 'Price drop', body: 'A saved listing in Hinjawadi dropped by ₹3,000/mo.', at: iso(daysAgo(3)), read: true },
    { id: 'N4', kind: 'system', title: 'Welcome to PuneNest', body: 'Find your home with zero brokerage.', at: iso(daysAgo(6)), read: true },
  ];
  db.messages = [
    { id: 'M1', threadId: 'TH1', withName: 'Rohan Patil', withRole: 'owner', listing: '2 BHK in Baner', last: 'Sure, you can visit tomorrow evening.', unread: 1, at: iso(daysAgo(0)),
      thread: [
        { from: 'them', text: 'Hi, the flat is available.', at: iso(daysAgo(1)) },
        { from: 'me', text: 'Great, can I visit this weekend?', at: iso(daysAgo(1)) },
        { from: 'them', text: 'Sure, you can visit tomorrow evening.', at: iso(daysAgo(0)) },
      ] },
    { id: 'M2', threadId: 'TH2', withName: 'Neha Kulkarni', withRole: 'owner', listing: '3 BHK in Wakad', last: 'Deposit is 2 months.', unread: 0, at: iso(daysAgo(2)),
      thread: [
        { from: 'me', text: 'What is the deposit?', at: iso(daysAgo(2)) },
        { from: 'them', text: 'Deposit is 2 months.', at: iso(daysAgo(2)) },
      ] },
  ];

  db.settings = {
    site: {
      name: 'PuneNest', legalName: 'PuneNest Realty Pvt. Ltd.', city: 'Pune',
      tagline: "Pune's most trusted zero-brokerage platform",
      supportEmail: 'hello@punenest.com', supportPhone: '+91 98765 43210',
      whatsapp: '+91 98765 43210', supportHours: 'Mon–Sat, 9:00 AM – 7:00 PM',
      address: 'PuneNest, 4th Floor, Trade Tower, Baner Road, Pune 411045', gst: '27ABCDE1234F1Z5',
      social: { instagram: 'https://instagram.com/punenest', facebook: 'https://facebook.com/punenest', linkedin: 'https://linkedin.com/company/punenest', twitter: 'https://x.com/punenest' },
    },
    fees: { ownerPlanYearly: 999, ownerProYearly: 2499, rentAgreementPlatform: 500, seekerPlusTopup: 199, featuredListing: 999, gstPercent: 18, rentPayPercent: 2 },
    // Keep in sync with APP_FLAG_SECTIONS in src/pages/admin/settings/AppFlagsPanel.jsx —
    // a key missing here renders OFF in admin but behaves ON at runtime (flagEnabled is `!== false`).
    flags: {
      societySaaS: false, newProjectListings: true, videoListings: false, mapSearch: true, compareProperties: true,
      savedListings: true, scheduleVisit: true, emiCalculator: true, reviewsEnabled: true,
      zeroBrokerage: true, onlineRentPayment: false, depositFinancing: false, paidFeaturedListings: true, subscriptionPlans: true,
      referralRewards: true,
      kycBadgeEnabled: true, ownerPhonePrivacy: true, listingVerification: true, reviewModeration: true,
      whatsappEnabled: true, inAppMessaging: true, emailNotifications: true, smsNotifications: true, pushNotifications: false,
      signupsEnabled: true, staffLoginEnabled: true, maintenanceMode: false,
    },
    permissions: {
      rental: ['view_dashboard', 'view_service_requests', 'update_ticket', 'export_csv'],
      legal: ['view_dashboard', 'view_service_requests', 'update_ticket', 'export_csv'],
      interior: ['view_dashboard', 'view_service_requests', 'update_ticket', 'export_csv'],
      packers: ['view_dashboard', 'view_service_requests', 'update_ticket', 'export_csv'],
      valuation: ['view_dashboard', 'view_service_requests', 'update_ticket', 'export_csv'],
      admin: ['*'],
    },
    customRoles: [
      { id: 'CR_requests', name: 'Requests Desk', modules: ['enquiries', 'services', 'postOnBehalf'], teams: [] },
      { id: 'CR_verify', name: 'Verifications Officer', modules: ['properties:verify'], teams: [] },
      { id: 'CR_content', name: 'Content Manager', modules: ['content', 'localities', 'societies'], teams: [] },
    ],
  };

  // Internal (service-side) portal accounts with scoped module access (admin RBAC demo).
  db.team = [
    { id: 'TM_admin', name: 'Administrator', mobile: '9000000000', email: 'admin@punenest.com', role: 'admin', roleId: null, moduleAccess: ['*'], teams: [], status: 'active', createdAt: iso(daysAgo(400)) },
    { id: 'TM_rohan', name: 'Rohan Kulkarni', mobile: '9800000001', email: 'rohan@punenest.com', role: 'manager', roleId: 'CR_verify', moduleAccess: [], teams: [], status: 'active', createdAt: iso(daysAgo(120)) },
    { id: 'TM_sneha', name: 'Sneha Patil', mobile: '9800000002', email: 'sneha@punenest.com', role: 'manager', roleId: 'CR_requests', moduleAccess: ['users'], teams: [], status: 'active', createdAt: iso(daysAgo(90)) },
    { id: 'TM_amit', name: 'Amit Deshpande', mobile: '9800000003', email: 'amit@punenest.com', role: 'manager', roleId: 'CR_content', moduleAccess: [], teams: [], status: 'active', createdAt: iso(daysAgo(60)) },
  ];

  // moderation reports
  const rr = rng(70707);
  const lreasons = [['sold', 'Already sold or rented out'], ['inaccurate', 'Incorrect or misleading details'], ['fake', 'Fake or duplicate listing'], ['brokerage', 'Asked for brokerage / advance payment']];
  const ureasons = [['fraud', 'Suspected fraud or scam'], ['impersonation', 'Fake or impersonated profile'], ['abuse', 'Abusive or harassing behaviour'], ['brokerage', 'Asked for brokerage / advance payment']];
  const details = ["The listing photos don't match what I saw during the visit.", 'Owner is asking for a token advance over UPI before any visit.', 'Same flat is posted twice with different prices.', 'The number connects to a broker, not the owner.', 'Property was already rented when I called.'];
  const lstR = db.listings.filter((l) => l.status === 'approved' || l.status === 'flagged');
  for (let i = 0; i < 5 && i < lstR.length; i++) {
    const l = lstR[i], lr = pick(rr, lreasons);
    db.reports.push({ id: 'REP' + (5000 + i), kind: 'listing', targetId: l.id, targetTitle: l.title, targetOwner: l.owner, ownerMobile: l.ownerMobile || '', deal: l.deal, reason: lr[0], reasonLabel: lr[1], details: pick(rr, details), reportedBy: genName(rr), reporterMobile: genMobile(rr), url: '/property/' + l.id, at: daysAgo(intp(rr, 0, 20)).getTime(), status: i < 3 ? 'open' : pick(rr, ['resolved', 'dismissed']), actionTaken: '', resolution: '', handledBy: '', handledAt: 0 });
  }
  const owR = db.users.filter((u) => u.role === 'owner');
  for (let j = 0; j < 3 && j < owR.length; j++) {
    const u = owR[j], ur = pick(rr, ureasons);
    db.reports.push({ id: 'REP' + (6000 + j), kind: 'user', targetId: u.id, targetTitle: u.name, targetOwner: u.name, ownerMobile: u.mobile || '', deal: '', reason: ur[0], reasonLabel: ur[1], details: pick(rr, details), reportedBy: genName(rr), reporterMobile: genMobile(rr), url: '/owner/' + u.id, at: daysAgo(intp(rr, 0, 25)).getTime(), status: j === 0 ? 'open' : pick(rr, ['open', 'resolved', 'dismissed']), actionTaken: '', resolution: '', handledBy: '', handledAt: 0 });
  }
  db.reports.sort((a, b) => b.at - a.at);

  // referral verification queue
  const rf = rng(424242);
  const risk = (o) => (o.aadhaarVerified && o.aadhaarUnique && !o.sameDevice && !o.sameIp && !o.velocityHigh ? 'low' : o.aadhaarVerified && o.aadhaarUnique ? 'medium' : 'high');
  const seedRef = [
    { channel: 'seeker', referrer: 'Aarav Sharma', referred: 'Riya Patil', aadhaarVerified: true, aadhaarUnique: true, sameDevice: false, sameIp: false, velocityHigh: false, activated: true, status: 'qualified' },
    { channel: 'seeker', referrer: 'Aarav Sharma', referred: 'Vikram Joshi', aadhaarVerified: true, aadhaarUnique: true, sameDevice: false, sameIp: false, velocityHigh: false, activated: true, status: 'rewarded' },
    { channel: 'seeker', referrer: 'Aarav Sharma', referred: 'Anon User', aadhaarVerified: false, aadhaarUnique: false, sameDevice: true, sameIp: true, velocityHigh: true, activated: false, status: 'flagged' },
    { channel: 'seeker', referrer: 'Neha Kulkarni', referred: 'Dup Aadhaar', aadhaarVerified: true, aadhaarUnique: false, sameDevice: false, sameIp: true, velocityHigh: false, activated: false, status: 'flagged' },
    { channel: 'owner', referrer: 'Neha Kulkarni', referred: 'Suresh Rao', aadhaarVerified: true, aadhaarUnique: true, sameDevice: false, sameIp: false, velocityHigh: false, activated: true, status: 'pending' },
    { channel: 'seeker', referrer: 'Karan Mehta', referred: 'Pending KYC', aadhaarVerified: false, aadhaarUnique: true, sameDevice: false, sameIp: false, velocityHigh: false, activated: false, status: 'pending' },
    { channel: 'owner', referrer: 'Karan Mehta', referred: 'Self Clone', aadhaarVerified: false, aadhaarUnique: false, sameDevice: true, sameIp: true, velocityHigh: true, activated: false, status: 'rejected' },
    { channel: 'seeker', referrer: 'Aarav Sharma', referred: 'Pooja Nair', aadhaarVerified: true, aadhaarUnique: true, sameDevice: false, sameIp: false, velocityHigh: false, activated: true, status: 'pending' },
  ];
  db.referrals = seedRef.map((o, i) => Object.assign({ id: 'RF' + (3000 + i), reward: o.channel === 'owner' ? 'Free rent agreement (1/3)' : '+15 owner contacts', referrerMobile: genMobile(rf), referredMobile: genMobile(rf), risk: risk(o), at: daysAgo(intp(rf, 0, 14)).getTime(), handledBy: '', handledAt: 0 }, o));

  return db;
}

// ---- precomputed analytics series ----
function analytics() {
  const traffic = (() => {
    const r = rng(424242), out = [], days = 30;
    for (let i = days - 1; i >= 0; i--) {
      const base = 1400 + (days - i) * 14;
      const wknd = [0, 6].includes(daysAgo(i).getDay()) ? 0.8 : 1;
      out.push({ date: iso(daysAgo(i)), visits: Math.round((base + r() * 600) * wknd), pageviews: Math.round((base * 3.4 + r() * 1800) * wknd), signups: Math.round((18 + r() * 26) * wknd) });
    }
    return out;
  })();
  const revenue = (() => {
    const r = rng(99), out = [], now = new Date(), names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ month: names[m.getMonth()], subscriptions: intp(r, 80, 180) * 1000, services: intp(r, 120, 320) * 1000, featured: intp(r, 20, 80) * 1000 });
    }
    return out;
  })();
  const sources = [{ k: 'Organic search', v: 38 }, { k: 'Direct', v: 22 }, { k: 'WhatsApp', v: 16 }, { k: 'Social', v: 13 }, { k: 'Paid ads', v: 11 }];
  const funnel = [{ k: 'Visitors', v: 100 }, { k: 'Searched', v: 64 }, { k: 'Viewed listing', v: 41 }, { k: 'Enquired', v: 18 }, { k: 'Visited', v: 9 }, { k: 'Closed', v: 4 }];
  return { traffic, revenue, sources, funnel };
}

const db = build();
const a = analytics();

const files = {
  'localities.json': db.localities,
  'users.json': db.users,
  'properties.json': db.listings,
  'tickets.json': db.tickets,
  'enquiries.json': db.enquiries,
  'visits.json': db.visits,
  'deals.json': db.deals,
  'services.json': db.services,
  'announcements.json': db.announcements,
  'reviews.json': db.reviews,
  'reports.json': db.reports,
  'referrals.json': db.referrals,
  'faqs.json': db.faqs,
  'banners.json': db.banners,
  'plans.json': db.plans,
  'reels.json': db.reels,
  'notifications.json': db.notifications,
  'messages.json': db.messages,
  'settings.json': db.settings,
  'analytics.json': a,
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
}
// also write a combined db for the mock API seeding step
writeFileSync(join(OUT, 'db.json'), JSON.stringify({ ...db, analytics: a }, null, 2));

console.log('Seed written to src/data:', Object.keys(files).length + 1, 'files,', db.listings.length, 'listings,', db.users.length, 'users.');
