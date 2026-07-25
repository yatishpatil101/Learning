const PROOF_TYPES = [
  ['maintenance', 'Maintenance receipt'],
  ['agreement', 'Sale / rent agreement'],
  ['utility', 'Utility bill (electricity/gas)'],
  ['allotment', 'Allotment / possession letter'],
  ['other', 'Other proof'],
];

const NOW_YEAR = new Date().getFullYear();

const HERO = [
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1400&q=80',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1400&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1400&q=80',
  'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1400&q=80',
];

const SOC_AMEN = {
  pool: ['Swimming Pool', 'waves'], gym: ['Gymnasium', 'dumbbell'], clubhouse: ['Clubhouse', 'building-2'],
  garden: ['Landscaped Garden', 'trees'], kids: ["Kids' Play Area", 'party-popper'], security: ['24x7 Security', 'shield-check'],
  ev: ['EV Charging', 'battery-charging'], jogging: ['Jogging Track', 'navigation'], sports: ['Sports Courts', 'dumbbell'],
  indoor: ['Indoor Games', 'layout-grid'], mall: ['Retail / Mall', 'shopping-bag'], concierge: ['Concierge', 'concierge-bell'],
  spa: ['Spa & Sauna', 'sparkles'],
};

const REVIEW_CATS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];
const TAB_IDS = ['overview', 'homes', 'reviews', 'community', 'location'];

// Community contributions (KYC-gated). One model, three kinds.
const CONTRIB_META = {
  tip: { label: 'Tip', icon: 'lightbulb', cats: ['Water', 'Parking', 'Safety', 'Amenities', 'Move-in', 'General'] },
  pick: { label: 'Local pick', icon: 'shopping-bag', cats: ['Maid', 'Cook / Tiffin', 'Milk / Grocery', 'Plumber', 'Electrician', 'Other'] },
  photo: { label: 'Photo', icon: 'image', cats: ['Entrance', 'Amenities', 'Garden', 'Lobby', 'Other'] },
};
const CONTRIB_FILTERS = [['all', 'All'], ['tip', 'Tips'], ['pick', 'Local picks'], ['photo', 'Photos']];

// Events & notices board (resident/committee-gated).
const BOARD_META = {
  event: { label: 'Event', icon: 'calendar', cats: ['Maintenance', 'Meeting / AGM', 'Festival', 'Utility / Water', 'Amenity', 'Other'] },
  notice: { label: 'Notice', icon: 'megaphone', cats: ['General', 'Security', 'Rules', 'Payment', 'Lost & Found', 'Other'] },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDate = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return m ? `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}` : ''; };

const timeAgo = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export {
  PROOF_TYPES,
  NOW_YEAR,
  HERO,
  SOC_AMEN,
  REVIEW_CATS,
  TAB_IDS,
  CONTRIB_META,
  CONTRIB_FILTERS,
  BOARD_META,
  MONTHS,
  DOW,
  ymd,
  prettyDate,
  timeAgo,
  titleCase,
};
