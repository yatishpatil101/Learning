// Pure presentational constants and class helpers shared across the My Listings
// panel and its sub-components. No React state — safe to keep at module scope.

// Deterministic placeholder so a property with no photo never renders an empty
// src (which forces a full-page re-fetch) and tests stay stable.
export const FALLBACK_IMG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' fill='#1b1730'/><path d='M22 52l12-14 9 10 6-7 9 11H22z' fill='#3a3550'/><circle cx='30' cy='30' r='5' fill='#3a3550'/></svg>",
  );

// Human labels for the furnishing field so the specs line reads naturally.
export const FURNISH_LABEL = { furnished: 'Furnished', semi: 'Semi-furnished', 'semi-furnished': 'Semi-furnished', unfurnished: 'Unfurnished' };

// Accent colour per stat tone. Kept tiny + shared so every chip in the strip
// speaks one visual language (icon + value + caption), only the accent changes.
export const CHIP_ACCENT = {
  muted: 'text-gray-400',
  teal: 'text-brand-teal-3',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
};

export const FRESHNESS_ICON = { active: 'shield-check', aging: 'clock', stale: 'alert-triangle', dormant: 'history' };

export const LISTING_STATUS_CLS = {
  approved: 'bg-emerald-500/15 text-emerald-300',
  pending: 'bg-amber-500/15 text-amber-300',
  rejected: 'bg-rose-500/15 text-rose-300',
  sold: 'bg-indigo-500/15 text-indigo-300',
  rented: 'bg-indigo-500/15 text-indigo-300',
  under_offer: 'bg-purple-500/15 text-purple-300',
  private: 'bg-white/10 text-gray-300',
};
export const STATUS_LABEL = { under_offer: 'Under Offer', private: 'Private', pending: 'Under review', approved: 'Live' };
export const STATUS_ICON = { approved: 'check-circle', pending: 'clock', rejected: 'x-circle', under_offer: 'handshake', sold: 'party-popper', rented: 'party-popper', private: 'lock' };

// Shared action styling: one prominent primary, quiet secondaries, danger for delete.
export const PRIMARY_TONE = {
  emerald: 'bg-emerald-500 hover:bg-emerald-600',
  teal: 'bg-brand-teal hover:bg-brand-teal-1',
};
export const primaryCls = (tone = 'teal') =>
  'text-[11px] px-3.5 py-1.5 rounded-lg font-semibold text-white inline-flex items-center gap-1.5 transition-colors ' + (PRIMARY_TONE[tone] || PRIMARY_TONE.teal);
export const quietCls = 'text-[11px] px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 font-semibold hover:bg-white/10 inline-flex items-center gap-1 transition-colors';
