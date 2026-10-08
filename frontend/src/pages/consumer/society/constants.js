/* User-visible values here are i18n keys, not copy: this module has no React context, so components resolve them at render. */

const NOW_YEAR = new Date().getFullYear();

const HERO = [
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1400&q=80',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1400&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1400&q=80',
  'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1400&q=80',
];

const SOC_AMEN = {
  pool: ['society.amenPool', 'waves'], gym: ['society.amenGym', 'dumbbell'], clubhouse: ['society.amenClubhouse', 'building-2'],
  garden: ['society.amenGarden', 'trees'], kids: ['society.amenKids', 'party-popper'], security: ['society.amenSecurity', 'shield-check'],
  ev: ['society.amenEv', 'battery-charging'], jogging: ['society.amenJogging', 'navigation'], sports: ['society.amenSports', 'dumbbell'],
  indoor: ['society.amenIndoor', 'layout-grid'], mall: ['society.amenMall', 'shopping-bag'], concierge: ['society.amenConcierge', 'concierge-bell'],
  spa: ['society.amenSpa', 'sparkles'],
};

/* Stored on each review as the category id, so ids must stay stable English; labels come from society.cat<Id>. */
const REVIEW_CATS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];
const REVIEW_CAT_KEYS = {
  Safety: 'society.catSafety',
  Maintenance: 'society.catMaintenance',
  Management: 'society.catManagement',
  Amenities: 'society.catAmenities',
  Connectivity: 'society.catConnectivity',
};
const TAB_IDS = ['overview', 'homes', 'reviews', 'location'];

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export {
  NOW_YEAR,
  HERO,
  SOC_AMEN,
  REVIEW_CATS,
  REVIEW_CAT_KEYS,
  TAB_IDS,
  titleCase,
};
