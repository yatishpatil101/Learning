import { INITIAL } from './filterState.js';

// Parse a natural-language query into a filter state (deal, locality, BHK, budget, +extras),
// mirroring the static app's smartSearch(): deal/location/BHK drive the actual filters.
// Pure — returns { next, deal, parts } or null for empty input. Shared by Smart search
// and Save search so a typed query always yields matching criteria AND label.
const GENERIC_LOC_WORDS = new Set(['nagar', 'road', 'park', 'east', 'west', 'new', 'the']);
const BHK_KEYS = { rent: ['0', '1', '2', '3', '3plus'], buy: ['1', '2', '3', '4', '5'] };

export function parseSmartQuery(raw, { fallbackDeal, localities, locNameBySlug }) {
  const q = (raw || '').toLowerCase().trim();
  if (!q) return null;

  const wantsRent = /\b(rent|rental|lease|tenant|pg)\b/.test(q);
  const wantsBuy = /\b(buy|sale|sell|purchase)\b/.test(q);
  const deal = wantsRent ? 'rent' : wantsBuy ? 'buy' : fallbackDeal;
  const next = INITIAL(deal);

  // Locality — match distinctive slug/name words as whole words
  localities.forEach((l) => {
    const words = new Set([...l.slug.split('-'), ...l.name.toLowerCase().split(/[\s,]+/)]);
    for (const w of words) {
      if (w.length >= 4 && !GENERIC_LOC_WORDS.has(w) && new RegExp('\\b' + w + '\\b').test(q)) {
        next.localities.add(l.slug);
        break;
      }
    }
  });

  // BHK
  const bhkM = q.match(/(\d)\s*(?:bhk|bed)/);
  if (bhkM) {
    const n = Number(bhkM[1]);
    const keys = BHK_KEYS[deal];
    let key = String(n);
    if (!keys.includes(key)) {
      if (deal === 'rent' && n > 3) key = '3plus';
      else if (deal === 'buy' && n >= 5) key = '5';
    }
    if (keys.includes(key)) next.bhk.add(key);
  }

  // Budget: "under/below/upto/max 1.5 cr" | "30k" | "50 lakh"
  const budM = q.match(/(?:under|below|upto|up to|max|budget)\s*₹?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|l|cr|crore)?/);
  if (budM) {
    const amt = parseFloat(budM[1]);
    const unit = budM[2] || '';
    let rupees;
    if (/cr|crore/.test(unit)) rupees = amt * 1e7;
    else if (/lakh|lac|^l$/.test(unit)) rupees = amt * 1e5;
    else if (/k|thousand/.test(unit)) rupees = amt * 1e3;
    else rupees = amt;
    if (deal === 'rent') next.rent = [0, Math.min(Math.round(rupees), 100000)];
    else next.budget = [0, Math.min(Math.round(rupees), 50000000)];
  }

  // Furnishing
  if (/semi[- ]?furnished/.test(q)) next.furnishing.add('semi');
  else if (/unfurnished|un-furnished/.test(q)) next.furnishing.add('unfurnished');
  else if (/furnished/.test(q)) next.furnishing.add('furnished');

  // Deal-specific extras
  if (deal === 'rent') {
    if (/pet[- ]?friendly|\bpets?\b/.test(q)) next.pets = true;
  } else {
    if (/ready to move|ready-to-move|ready possession/.test(q)) next.avail = 'ready';
    else if (/under construction/.test(q)) next.avail = 'uc';
  }

  const parts = [];
  if (bhkM) parts.push(bhkM[1] + ' BHK');
  parts.push(deal === 'rent' ? 'Rent' : 'Buy');
  if (next.localities.size) parts.push([...next.localities].map((s) => locNameBySlug[s] || s).join(', '));
  if (budM) parts.push('under ' + budM[1] + (budM[2] || ''));

  return { next, deal, parts };
}
