/* Formatting + small helpers shared across the app (ports AdminUI.esc/fmtINR/fmtNum). */

/**
 * Format an ISO date string (yyyy-mm-dd) as DD/MM/YYYY for display.
 * Guarantees the Indian date order regardless of the browser/OS locale.
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

export function rentLabel(n) {
  return fmtINR(n) + '/mo';
}

export function priceLabel(p) {
  return p.deal === 'rent' ? rentLabel(p.price) : fmtINR(p.price);
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  // Unparseable input passes through verbatim (callers seed literals like
  // "Just now"), but ALWAYS as a string — a null/undefined createdAt used to
  // leak straight back out and blow up callers doing .toLowerCase() on it.
  if (Number.isNaN(diff)) return String(iso ?? '');
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 30) return diff + ' days ago';
  return d.toLocaleDateString('en-IN');
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
