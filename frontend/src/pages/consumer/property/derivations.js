export const AMEN_ICON = {
  gym: 'sparkles', pool: 'sparkles', lift: 'building', parking: 'car-front', security: 'shield-check',
  power: 'landmark', garden: 'trees', club: 'users', play: 'paw-print',
};
export const AMEN_LABEL = {
  gym: 'Gymnasium', pool: 'Swimming Pool', lift: 'Lift', parking: 'Covered Parking', security: '24x7 Security',
  power: 'Power Backup', garden: 'Landscaped Garden', club: 'Clubhouse', play: "Kids' Play Area",
};

/* A bucket, not a date, because a date on a listing nobody edits is wrong within a fortnight. The wire
   value is a token to translate; `null` is the API's "unstated" and stays unsaid. */
const AVAILABLE_FROM_KEY = { now: 'immediately', 15: 'within15Days', 30: 'within30Days' };
// Bounded, because a flatmate `availableFrom` — a real LocalDate — would otherwise mint one
// permanent entry per distinct date.
const WARN_CAP = 20;
const warnedBuckets = new Set();
export function availableLabel(tr, value) {
  if (!value) return '\u2014';
  if (!Object.hasOwn(AVAILABLE_FROM_KEY, value)) {
    if (!warnedBuckets.has(value) && warnedBuckets.size < WARN_CAP) {
      warnedBuckets.add(value);
      console.warn(`[property] unmapped availableFrom bucket "${value}" — add it to AVAILABLE_FROM_KEY`);
    }
    return '\u2014';
  }
  return tr('property.' + AVAILABLE_FROM_KEY[value]);
}

/* Classifies a listing so the detail page shows only the fields that make sense: land gets zone and title,
   commercial gets no bedroom or bathroom rows. */
const LAND_MATCHES = ['plot', 'land', 'farm'];
const COMMERCIAL_MATCHES = ['office', 'shop', 'showroom', 'retail', 'mall', 'warehouse', 'godown', 'industrial', 'factory', 'co-working', 'coworking', 'commercial'];
export function propertyKind(p) {
  const t = String(p?.type || '').toLowerCase();
  if (LAND_MATCHES.some((k) => t.includes(k))) return 'land';
  if (COMMERCIAL_MATCHES.some((k) => t.includes(k))) return 'commercial';
  return 'residential';
}

/* No id-derived fallback: it makes an unstated attribute indistinguishable from a stated one. Unstated
   returns '' and the tile reads "Not specified". */
import { ageOptions } from '../list-property/constants.js';
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const SHORT_AGE = {
  'under-construction': 'Under Const.', 'new': 'New',
  '1-5': '1–5 yrs', '5-10': '5–10 yrs', '10-15': '10–15 yrs', '15+': '15+ yrs',
};

/* All three return '' when nothing was stated. Deriving a floor, facing or age from the listing id would
   print a guess as surveyed fact, and facing is Vastu-weighted in this market, so it moves offers. */
export function deriveFloor(p) {
  const raw = p.form?.floor || (p.floor ? String(p.floor) : '');
  if (!raw) return '';
  const total = p.form?.totalFloors || p.totalFloors;
  // `ordinal(NaN)` renders the literal "NaNth", and admin post-on-behalf emits non-numeric floor
  // strings, so anything unparseable passes through as typed.
  const n = Number(raw);
  const label = raw === 'Ground' ? 'Ground' : (Number.isFinite(n) ? ordinal(n) : String(raw));
  return total ? `${label} of ${total}` : label;
}
export function deriveFacing(p) {
  if (p.facing) return p.facing;
  if (p.form?.facing) return p.form.facing;
  return '';
}
export function deriveOverlooking(p) {
  if (p.overlooking) return p.overlooking;
  if (p.form?.overlooking) return p.form.overlooking;
  return '';
}
export function deriveAge(p) {
  const key = p.age || p.form?.age;
  if (key) return SHORT_AGE[key] || (ageOptions.find((o) => o.value === key)?.label) || key;
  if (p.construction === 'new') return 'New';
  // `ageYears` is the server's stated age in whole years (V95, nullable — null means the owner
  // never said, which is not the same as new).
  if (p.ageYears != null) return p.ageYears + (p.ageYears === 1 ? ' Year' : ' Years');
  return '';
}
