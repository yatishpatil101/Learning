/* Listing freshness / anti-staleness model.
   A listing carries `freshenedAt` = the last time the owner confirmed it is genuinely
   live/available (set on post, on edit, and via the one-click "Confirm still available"
   action). The state below is DERIVED purely from how long ago that was — never mutated
   on read — so nothing gets stuck: the moment an owner confirms, everything re-derives.

   States by age since last confirmation:
     active  (<= FRESH_DAYS)   listing is trustworthy, "actively managed"
     aging   (<= AGING_DAYS)   gently nudge the owner to confirm
     stale   (<= STALE_DAYS)   strong nudge; warn buyers availability is unconfirmed
     dormant (> STALE_DAYS)    owner went dark — hide from buyers, ask owner to reactivate

   Falls back to `createdAt` when `freshenedAt` is absent, so legacy/seed listings work. */

export const FRESH_DAYS = 7;
export const AGING_DAYS = 14;
export const STALE_DAYS = 30;

const DAY_MS = 86400000;

/* Listings carry `createdAt` as either an epoch-ms number (Date.now(), from the
   post-a-property flow) or an ISO date string (seed catalog / admin posts). Parse
   either shape to a timestamp so date sorts stay consistent; 0 for missing/invalid. */
export function createdMs(v) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/* Days elapsed since the listing was last confirmed live (>= 0). */
export function daysSinceFresh(listing, now = Date.now()) {
  const src = (listing && (listing.freshenedAt || listing.createdAt)) || null;
  if (!src) return 0;
  const t = new Date(src).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

export function freshnessState(listing, now = Date.now()) {
  const d = daysSinceFresh(listing, now);
  if (d <= FRESH_DAYS) return 'active';
  if (d <= AGING_DAYS) return 'aging';
  if (d <= STALE_DAYS) return 'stale';
  return 'dormant';
}

/* True once a listing has gone dark long enough to hide from buyers. */
export function isDormant(listing, now = Date.now()) {
  return freshnessState(listing, now) === 'dormant';
}

/* Owner needs to act (confirm/reactivate) once a listing is aging or worse. */
export function needsAttention(listing, now = Date.now()) {
  return freshnessState(listing, now) !== 'active';
}

function sinceLabel(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/* One call returns everything the UI needs for a listing, split into an owner-facing
   view (dashboard pills/CTAs) and a buyer-facing view (transparency signal). */
export function listingFreshness(listing, now = Date.now()) {
  const state = freshnessState(listing, now);
  const days = daysSinceFresh(listing, now);
  const since = sinceLabel(days);

  const OWNER = {
    active: { label: 'Active', tone: 'emerald', cta: null },
    aging: { label: 'Confirm soon', tone: 'amber', cta: 'confirm' },
    stale: { label: 'Stale', tone: 'rose', cta: 'confirm' },
    dormant: { label: 'Paused', tone: 'gray', cta: 'reactivate' },
  }[state];

  const BUYER = {
    active: {
      show: true,
      tone: 'emerald',
      icon: 'shield-check',
      label: 'Owner confirmed available — actively managed',
      short: 'Confirmed available',
    },
    aging: {
      show: true,
      tone: 'gray',
      icon: 'clock',
      label: `Owner last confirmed availability ${since}`,
      short: `Updated ${since}`,
    },
    stale: {
      show: true,
      tone: 'amber',
      icon: 'alert-triangle',
      label: `Availability not confirmed in ${days} days — ask the owner if it's still available`,
      short: 'Availability not recently confirmed',
    },
    // Dormant listings are hidden from buyers, so no public label is needed.
    dormant: {
      show: false,
      tone: 'gray',
      icon: 'moon',
      label: '',
      short: '',
    },
  }[state];

  return { state, days, since, owner: OWNER, buyer: BUYER };
}
