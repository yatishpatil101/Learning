/* Society constants.
 *
 * Everything user-visible here is an i18n *key*, not copy. This module has no
 * React context so it cannot call the translator itself — components resolve the
 * keys at render. Holding English strings here would have made this file a
 * second, untranslated copy deck that only shows up for Hindi and Marathi
 * readers. Same rule as lib/authIntent.js.
 */

const PROOF_TYPES = [
  ['maintenance', 'society.proofMaintenance'],
  ['agreement', 'society.proofAgreement'],
  ['utility', 'society.proofUtility'],
  ['allotment', 'society.proofAllotment'],
  ['other', 'society.proofOther'],
];

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

/* Review categories are stored on each review as the *category id*, so these ids
   must stay stable English — renaming one would orphan every stored rating. The
   label shown to the reader comes from `society.cat<Id>`. */
const REVIEW_CATS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];
const REVIEW_CAT_KEYS = {
  Safety: 'society.catSafety',
  Maintenance: 'society.catMaintenance',
  Management: 'society.catManagement',
  Amenities: 'society.catAmenities',
  Connectivity: 'society.catConnectivity',
};
const TAB_IDS = ['overview', 'homes', 'reviews', 'community', 'location'];

// Community contributions (sign-in only). One model, three kinds.
// `cats` hold stored category ids and stay English; `catKeys` maps them to labels.
const CONTRIB_META = {
  tip: { labelKey: 'society.contribTip', addKey: 'society.contribAddTip', icon: 'lightbulb', cats: ['Water', 'Parking', 'Safety', 'Amenities', 'Move-in', 'General'] },
  pick: { labelKey: 'society.contribPick', addKey: 'society.contribAddPick', icon: 'shopping-bag', cats: ['Maid', 'Cook / Tiffin', 'Milk / Grocery', 'Plumber', 'Electrician', 'Other'] },
  photo: { labelKey: 'society.contribPhoto', addKey: 'society.contribAddPhoto', icon: 'image', cats: ['Entrance', 'Amenities', 'Garden', 'Lobby', 'Other'] },
};
const CONTRIB_FILTERS = [['all', 'society.filterAll'], ['tip', 'society.filterTips'], ['pick', 'society.filterPicks'], ['photo', 'society.filterPhotos']];

// Events & notices board (resident/committee-gated).
const BOARD_META = {
  event: { labelKey: 'society.boardEvent', addKey: 'society.boardAddEvent', icon: 'calendar', cats: ['Maintenance', 'Meeting / AGM', 'Festival', 'Utility / Water', 'Amenity', 'Other'] },
  notice: { labelKey: 'society.boardNotice', addKey: 'society.boardAddNotice', icon: 'megaphone', cats: ['General', 'Security', 'Rules', 'Payment', 'Lost & Found', 'Other'] },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Format a YYYY-MM-DD as a short human date in the given language. Intl already
   ships month names for hi and mr, so there is nothing to translate by hand —
   and nothing that can drift out of sync with the locale files. Callers pass the
   active language; omitting it falls back to English rather than the visitor's
   OS locale, which would otherwise leak a fourth language into the page. */
const prettyDate = (s, locale = 'en') => {
  const [y, m, d] = (s || '').split('-').map(Number);
  if (!m) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(y, m - 1, d));
};

/* Relative time. Returns a key plus its count so the caller can translate —
   returning a formatted English string here would bypass i18n entirely. */
const timeAgo = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return { key: 'society.justNow' };
  const m = Math.floor(s / 60); if (m < 60) return { key: 'society.minutesAgo', count: m };
  const h = Math.floor(m / 60); if (h < 24) return { key: 'society.hoursAgo', count: h };
  const d = Math.floor(h / 24); if (d < 30) return { key: 'society.daysAgo', count: d };
  const mo = Math.floor(d / 30); if (mo < 12) return { key: 'society.monthsAgo', count: mo };
  return { key: 'society.yearsAgo', count: Math.floor(mo / 12) };
};

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export {
  PROOF_TYPES,
  NOW_YEAR,
  HERO,
  SOC_AMEN,
  REVIEW_CATS,
  REVIEW_CAT_KEYS,
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
