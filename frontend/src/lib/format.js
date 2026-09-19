/* Formatting + small helpers shared across the app (ports AdminUI.esc/fmtINR/fmtNum). */

/** Parse a price/amount string ("₹25,000/mo") into an integer. */
export const parseAmount = (s) => parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10) || 0;

/**
 * Format an ISO date (yyyy-mm-dd) as DD/MM/YYYY, guaranteeing Indian order regardless of browser locale.
 * Returns '' for empty/invalid input so callers can show a placeholder.
 */
export function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function fmtINR(n) {
  const num = Number(n) || 0;
  if (num >= 10000000) return '₹' + (num / 10000000).toFixed(2).replace(/\.00$/, '') + ' Cr';
  if (num >= 100000) return '₹' + (num / 100000).toFixed(2).replace(/\.00$/, '') + ' L';
  return '₹' + num.toLocaleString('en-IN');
}

export function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('en-IN');
}

/* Mirrors the units the wizard offers; land is priced in acre and guntha, so a hardcoded "sq.ft." rendered a
   2-acre farm as "2 sq.ft." An unknown unit is printed verbatim, an absent one is the documented sq.ft. */
const AREA_UNIT_LABEL = {
  // No prototype: `areaUnit` arrives off the wire, and a plain literal answers `'constructor'`
  // with a function, which `??` would then accept as a label.
  __proto__: null,
  sqft: 'sq.ft.', sqyd: 'sq.yd.', guntha: 'Guntha', acre: 'Acre', hectare: 'Hectare',
};

export function fmtArea(area, unit) {
  return area ? `${fmtNum(area)} ${AREA_UNIT_LABEL[unit] ?? (unit || 'sq.ft.')}` : '';
}

/* Whether a ₹-per-unit figure may be captioned "per sq.ft." An unstated unit is sq.ft. — that is
   the contract's default, and `''` is what the wire writes for one. */
export const isSqftUnit = (unit) => (unit || 'sqft') === 'sqft';

export function rentLabel(n) {
  return fmtINR(n) + '/mo';
}

export function priceLabel(p) {
  return p.deal === 'rent' ? rentLabel(p.price) : fmtINR(p.price);
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  // Unparseable input passes through verbatim (callers seed literals like "Just now") but ALWAYS as a
  // string, so a null createdAt cannot blow up a caller doing .toLowerCase() on it.
  if (Number.isNaN(diff)) return String(iso ?? '');
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 30) return diff + ' days ago';
  return d.toLocaleDateString('en-IN');
}

/**
 * Coarse "how long ago" at the granularity ops triage on: minutes, then hours, then days. Distinct from
 * {@link timeAgo}, whose "Today" hides the 20-minutes-vs-20-hours difference a moderation queue runs on.
 */
export function fmtAgo(ts) {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (!t || Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(t).toLocaleDateString('en-IN');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function classNames(...xs) {
  return xs.filter(Boolean).join(' ');
}

export function avatarFor(name) {
  return (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
