import { INITIAL, RANGE, normBhk, serializeF, deserializeF } from '../../../lib/listings/filterState.js';
import { sectionVisible } from '../../../lib/listings/filterRelevance.js';
import { SEARCH_TYPES, BUY_TYPES, RENT_TYPES } from '../../../data/propertyTypes.js';
import { AMEN_BUY, AMEN_RENT, AMEN_LBL, FURN_LBL } from './constants.js';

/* Parses a natural-language query into filter state, for Smart search and Save search alike.

   Two contracts the callers depend on. The parse MERGES onto the filters already on screen, because
   a typed phrase refines the search the user has been building rather than restarting it. And every
   word it could not claim comes back as `q`, because a society, a builder or a landmark is exactly
   what a shopper types and none of them is a facet. */
const GENERIC_LOC_WORDS = new Set([
  'nagar', 'road', 'park', 'east', 'west',
  // City-wide words and bare suffixes: alone they name no area, so a query that merely mentions the
  // city would otherwise select every locality carrying the suffix.
  'pune', 'city', 'gaon', 'wadi', 'peth', 'pimpri',
  // Left to the amenity rule: only Boat Club Road carries it, and that name still has "boat".
  'club',
]);

/* Connectors and politeness. An `in` forwarded to a LIKE matches half the catalogue, and "pune" on
   a Pune-only marketplace matches none of it, since no title or locality repeats the city. */
const FILLER = new Set([
  'in', 'at', 'for', 'with', 'and', 'or', 'of', 'on', 'to', 'a', 'an', 'the', 'is', 'are', 'any',
  'i', 'me', 'my', 'we', 'want', 'need', 'looking', 'search', 'searching', 'show', 'find', 'get',
  'please', 'available', 'property', 'properties', 'place', 'places', 'pune', 'city',
  // Comparison words the money rule did not claim, because the figure beside them turned out to be
  // a size: on their own they name nothing.
  'under', 'below', 'upto', 'above', 'over', 'within', 'max', 'min',
]);

/* The rent slider's ceiling is also the line between the two journeys: above it the Rent tab cannot
   express the number at all, so clamping lands on the default and filters nothing. */
const RENT_CEILING = RANGE.rent[1];

// What a shopper types ("elevator", "power backup") is not what the chip says, so this cannot be
// derived from the `AMEN_*` option lists.
const AMENITY_WORDS = [
  ['gym', /\b(?:gym|gymnasium)\b/],
  ['pool', /\b(?:swimming pool|pool)\b/],
  ['lift', /\b(?:lift|elevator)\b/],
  ['parking', /\b(?:car parking|parking)\b/],
  ['security', /\b(?:security|gated)\b/],
  ['power', /\b(?:power backup|dg backup|generator)\b/],
  ['garden', /\bgarden\b/],
  ['club', /\b(?:club\s?house|club)\b/],
];

/* Longest first, so "independent house" is claimed whole before the bare "house" can take half of
   it. Derived from the browse taxonomy's `matches`, which `flatmates` has none of — it is resolved
   from `shareType`, not from the type string. */
const TYPE_PHRASES = SEARCH_TYPES
  .flatMap((t) => (t.key === 'flatmates'
    ? ['flatmate', 'flatmates', 'roommate', 'shared room', 'pg']
    : t.matches || []).map((w) => [t.key, w]))
  .sort((a, b) => b[1].length - a[1].length);

const UNIT = '(k|thousand|lakh|lakhs|lac|lacs|l|cr|crore|crores)?';
/* A figure trailed by a land unit is a size, not a price: "office under 1000 sqft" must not become
   a budget of ₹1,000, a reading that would also throw the search onto the other tab. The second
   lookahead covers the low end of a size RANGE, whose own unit sits after the high end. */
const SIZE_UNIT = '(?:sq|acre|guntha|gunthe|cent|hectare|yard)';
const NOT_A_SIZE = `(?!\\s*${SIZE_UNIT})(?!\\s*(?:-|–|to)\\s*\\d+(?:\\.\\d+)?\\s*${SIZE_UNIT})`;
const AMOUNT = `(?:₹|rs\\.?)?\\s*\\b(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\b${NOT_A_SIZE}`;
const MAX_WORDS = 'under|below|upto|up to|max|maximum|within|less than|budget|at most|atmost';
const MIN_WORDS = 'above|over|more than|min|minimum|at least|atleast|starting at|starting from';

const RANGE_RE = new RegExp(`${AMOUNT}\\s*(?:-|–|to)\\s*${AMOUNT}`);
const MAX_RE = new RegExp(`\\b(?:${MAX_WORDS})\\s*${AMOUNT}`);
const MIN_RE = new RegExp(`\\b(?:${MIN_WORDS})\\s*${AMOUNT}`);
const BARE_RE = new RegExp(AMOUNT);

/* Locality names are data, not pattern source: a `.` or `(` in one would otherwise be compiled as
   syntax and either match the wrong places or throw — taking down the whole submit, since this runs
   over every locality before any of the parse is applied. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w) => new RegExp('\\b' + escapeRe(w) + '\\b');

const toRupees = (amt, unit) => {
  if (!unit) return amt;
  if (/^cr/.test(unit)) return amt * 1e7;
  if (/^(?:lakh|lakhs|lac|lacs|l)$/.test(unit)) return amt * 1e5;
  return amt * 1e3;
};

// Fresh Sets are the point: they are the only members a parse adds to rather than replaces, so this
// is what stops it writing through into the filter state still on screen.
const cloneFilters = (f) => deserializeF(serializeF(f));

/* "80,00,000" is how the amount is written here, so splitting on the comma would read it as ₹80.
   Collapsing whitespace matters as much: the money patterns nest optional groups around `\s*`, and
   a pasted run of spaces makes them backtrack for tens of seconds on the main thread. */
const normalise = (s) => s.replace(/(\d),(?=\d)/g, '$1').replace(/[,;/]/g, ' ').replace(/\s+/g, ' ');

export function parseSmartQuery(raw, { current, localities, locNameBySlug }) {
  const typed = (raw || '').toLowerCase().trim();
  if (!typed) return null;

  /* The parse is destructive on purpose: each rule blanks the text it claimed, so what survives to
     the end is exactly the words no rule understood — which is what `q` has to carry. */
  let rest = ` ${normalise(typed)} `;
  const peek = (re) => rest.match(re);
  const eat = (re) => {
    const m = rest.match(re);
    // Spliced by index rather than by `String.replace`, which would blank the first occurrence of
    // the matched text and not necessarily the span that matched.
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };

  const wantsRent = eat(/\b(?:rent|rental|rentals|rented|lease|tenant|tenants|to let)\b/);
  const wantsBuy = wantsRent ? null : eat(/\b(?:buy|sale|sell|purchase|resale)\b/);
  const explicitDeal = wantsRent ? 'rent' : wantsBuy ? 'buy' : null;

  /* RK and studio before the type rule, because "studio" is also one of the browse taxonomy's
     matches for Flat — it is both the size and the kind, and only one rule may consume it. Both
     before localities, because the digit in "3 bhk" is also a word of "Hinjawadi Phase 3". */
  const rkM = eat(/\b(?:1\s*rk|rk|studio)\b/);
  const bhkM = eat(/\b(\d)\s*(?:bhk|bed\s?rooms?|beds?)\b/);

  /* Localities are read early so an area name keeps its whole self: "Pimple Saudagar" must not leave
     "saudagar" stranded in the free text. Richest match first, because the registry holds
     overlapping names — "Pimple Gurav" beside "Pimple Saudagar", "Hinjawadi Phase 2" beside
     "Hinjawadi" — and whichever is read first eats the shared word. A tie goes to the shorter name,
     which is the one the query accounted for in full. */
  const locSlugs = [];
  localities
    .map((l) => {
      const words = [...new Set([...l.slug.split('-'), ...l.name.toLowerCase().split(/[\s,]+/)])].filter(Boolean);
      return { slug: l.slug, words, score: words.filter((w) => word(w).test(rest)).length };
    })
    .sort((a, b) => b.score - a.score || a.words.length - b.words.length)
    .forEach(({ slug, words }) => {
      // Re-tested against what is left: a richer name may already have taken the only word that
      // qualified this one.
      if (!words.some((w) => w.length >= 4 && !GENERIC_LOC_WORDS.has(w) && word(w).test(rest))) return;
      locSlugs.push(slug);
      words.forEach((w) => eat(word(w)));
    });

  // "near Baner" resolves to the same locality filter; the connector is noted only so the summary
  // can say "near Baner" rather than restate it as the area itself.
  const nearWord = Boolean(eat(/\b(?:nearby|near|close to|next to|walking distance (?:of|to|from))\b/));

  /* Two different claims, so two reads: "no broker" is about who posted the listing, a bare "owner"
     is likelier to mean the identity check. The compound phrases must be eaten first or the bare
     pattern would take the word out of "owner only" and leave the modifier stranded. */
  const ownerOnly = Boolean(eat(/\b(?:owner only|only owner|direct owner|no broker|nobroker|without broker)\b/));
  const verifiedOwner = Boolean(eat(/\bowner\b/));

  const readyM = eat(/\b(?:ready to move|ready-to-move|ready possession|ready)\b/);
  const ucM = readyM ? null : eat(/\b(?:under construction|under-construction|new launch)\b/);

  let furnishing = null;
  if (eat(/\bsemi[- ]?furnished\b/)) furnishing = 'semi';
  else if (eat(/\b(?:unfurnished|un-furnished|not furnished|bare shell)\b/)) furnishing = 'unfurnished';
  else if (eat(/\b(?:fully furnished|furnished)\b/)) furnishing = 'furnished';

  const amenHits = AMENITY_WORDS.flatMap(([k, re]) => { const m = eat(re); return m ? [[k, m[0].trim()]] : []; });
  const pets = Boolean(eat(/\b(?:pet[- ]?friendly|pets allowed|pets?)\b/));

  // Every phrase is eaten, not just the first per key, so "commercial shop" does not leave "shop"
  // behind as free text.
  const typeHits = [];
  TYPE_PHRASES.forEach(([key, phrase]) => {
    const m = eat(word(phrase));
    if (m) typeHits.push([key, m[0].trim()]);
  });
  const typeKeys = [...new Set(typeHits.map(([k]) => k))];
  if (rkM && !typeKeys.includes('flat')) typeKeys.push('flat');

  const money = readMoney(eat, peek);

  /* Deal, strongest signal first. An explicit word is a statement; a shared-room search exists only
     on Rent; otherwise the magnitude decides, because the rent slider's ceiling is also the line
     above which no amount is a rent — and staying put there clamps to that ceiling, which is the
     default, and so filters nothing at all. */
  let deal = explicitDeal || current.deal;
  if (!explicitDeal && typeKeys.includes('flatmates')) deal = 'rent';
  else if (!explicitDeal && money.amount != null) deal = money.amount > RENT_CEILING ? 'buy' : 'rent';
  const isRent = deal === 'rent';

  /* Switching journey resets, exactly as the Rent/Buy toggle does: the two carry different filter
     shapes, so a Buy area range or a Rent tenant set has no meaning on the other side. Within one
     journey the typed phrase adds to whatever the panel already holds. */
  const next = current.deal === deal ? cloneFilters(current) : INITIAL(deal);

  locSlugs.forEach((s) => next.localities.add(s));

  /* A key the other journey's panel does not offer goes back to the free text rather than being
     dropped: the whole point of the remainder is that nothing the shopper typed disappears. */
  const allowedTypes = new Set((isRent ? RENT_TYPES : BUY_TYPES).map(([k]) => k));
  const usedTypes = typeKeys.filter((k) => allowedTypes.has(k));
  usedTypes.forEach((k) => next.types.add(k));
  typeHits.forEach(([k, text]) => { if (!allowedTypes.has(k)) rest += ` ${text}`; });

  // A section the chosen type hides has no control in the panel, so a value written into it would
  // sit dormant in state and spring into effect the moment the type changed.
  let bhkKey = bhkM ? normBhk(bhkM[1], deal) : rkM ? normBhk('0', deal) : null;
  if (bhkKey && !sectionVisible('bhk', next.types)) bhkKey = null;
  if (bhkKey) next.bhk.add(bhkKey);

  const furn = furnishing && sectionVisible('furnishing', next.types) ? furnishing : null;
  if (furn) next.furnishing.add(furn);

  const allowedAmen = new Set((isRent ? AMEN_RENT : AMEN_BUY).map(([k]) => k));
  const usedAmen = amenHits.map(([k]) => k).filter((k) => allowedAmen.has(k));
  usedAmen.forEach((k) => next.amenities.add(k));
  amenHits.forEach(([k, text]) => { if (!allowedAmen.has(k)) rest += ` ${text}`; });

  if (ownerOnly) next.ownerOnly = true;
  if (verifiedOwner) next.verified = { ...next.verified, owner: true };
  if (isRent) {
    if (pets) next.pets = true;
  } else if (readyM) next.avail = 'ready';
  else if (ucM) next.avail = 'uc';

  if (money.amount != null) applyMoney(next, isRent, money);

  const parts = [];
  if (bhkKey) parts.push(bhkM ? `${bhkM[1]} BHK` : '1 RK / Studio');
  parts.push(isRent ? 'Rent' : 'Buy');
  const typeLabels = Object.fromEntries(isRent ? RENT_TYPES : BUY_TYPES);
  usedTypes.forEach((k) => parts.push(typeLabels[k]));
  if (locSlugs.length) {
    const names = locSlugs.map((s) => locNameBySlug[s] || s).join(', ');
    parts.push(nearWord ? `near ${names}` : names);
  }
  if (money.amount != null) parts.push(money.text);
  if (furn) parts.push(FURN_LBL[furn]);
  usedAmen.forEach((k) => parts.push(AMEN_LBL[k] || k));
  if (isRent && pets) parts.push('Pet-friendly');
  if (!isRent && next.avail) parts.push(next.avail === 'ready' ? 'Ready to Move' : 'Under Construction');
  if (ownerOnly) parts.push('Owner only');
  if (verifiedOwner) parts.push('Verified Owner');

  const q = rest.split(/\s+/).filter((w) => w && !FILLER.has(w)).join(' ');
  return { next, deal, parts, q };
}

/* The amount, in rupees, however it was phrased. `lo` and `hi` are independently nullable: "above
   1 cr" states a floor and no ceiling, and forcing the missing end to a default here would invent a
   bound the user did not type. */
function readMoney(eat, peek) {
  const rangeM = eat(RANGE_RE);
  if (rangeM) {
    // "50-80 lakh" writes the unit once, at the end; the lower bound inherits it, because a range
    // whose ends sit five orders of magnitude apart is not what anybody meant.
    const unit = rangeM[2] || rangeM[4];
    const a = toRupees(parseFloat(rangeM[1]), unit);
    const b = toRupees(parseFloat(rangeM[3]), rangeM[4] || unit);
    const hi = Math.max(a, b);
    return { lo: Math.min(a, b), hi, amount: hi, text: rangeM[0].trim() };
  }
  const maxM = eat(MAX_RE);
  if (maxM) {
    const hi = toRupees(parseFloat(maxM[1]), maxM[2]);
    return { lo: null, hi, amount: hi, text: maxM[0].trim() };
  }
  const minM = eat(MIN_RE);
  if (minM) {
    const lo = toRupees(parseFloat(minM[1]), minM[2]);
    return { lo, hi: null, amount: lo, text: minM[0].trim() };
  }
  /* A bare amount with no preposition — "2 bhk baner 25k" is how the box is actually typed. Read
     last, and only once every rule that owns a number has taken its own, so the 2 in "2 BHK" can no
     longer be read as a budget. An unsuffixed figure must clear ₹1,000 to count: below that it is a
     floor, a phase or a year rather than a price — and it is only eaten once it has counted, so a
     rejected figure survives into `q` as the flat number it probably was. */
  const bareM = peek(BARE_RE);
  if (bareM && (bareM[2] || parseFloat(bareM[1]) >= 1000)) {
    eat(BARE_RE);
    const hi = toRupees(parseFloat(bareM[1]), bareM[2]);
    return { lo: null, hi, amount: hi, text: bareM[0].trim() };
  }
  return { lo: null, hi: null, amount: null, text: '' };
}

function applyMoney(next, isRent, money) {
  const key = isRent ? 'rent' : 'budget';
  const [dLo, dHi] = RANGE[key];
  const clamp = (v) => Math.min(Math.max(Math.round(v), dLo), dHi);
  next[key] = [money.lo == null ? dLo : clamp(money.lo), money.hi == null ? dHi : clamp(money.hi)];
}
