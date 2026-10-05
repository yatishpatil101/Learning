// Placeholder is deterministic so no-photo properties never render an empty src.
// Pure presentational constants stay module-scoped because they hold no React state.
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
  approved: 'bg-brand-teal/10 text-brand-teal-3',
  paused: 'bg-slate-500/15 text-slate-300',
  pending: 'bg-amber-500/15 text-amber-300',
  rejected: 'bg-white/5 text-gray-300',
  sold: 'bg-indigo-500/15 text-indigo-300',
  rented: 'bg-indigo-500/15 text-indigo-300',
  under_offer: 'bg-purple-500/15 text-purple-300',
  private: 'bg-white/10 text-gray-300',
  expired: 'bg-rose-500/15 text-rose-300',
};
export const STATUS_LABEL = { under_offer: 'Under Offer', private: 'Private', pending: 'Under review', approved: 'Live', paused: 'Paused', rejected: 'Not approved', sold: 'Sold', rented: 'Rented', archived: 'Archived', expired: 'Expired' };
export const STATUS_ICON = { approved: 'check-circle', paused: 'pause-circle', pending: 'clock', rejected: 'x-circle', under_offer: 'handshake', sold: 'party-popper', rented: 'party-popper', private: 'lock', expired: 'clock' };
// Shared action styling: one prominent primary, quiet secondaries, danger for delete.
