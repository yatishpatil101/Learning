import { Link } from 'react-router';
import Icon from '../Icon.jsx';
import ProgressTracker from './ProgressTracker.jsx';
import { seeksOwnershipBadge } from '../../lib/recheckFields.js';

const statusKey = (suffix) => ['owner', 'listingStatus', ...String(suffix).split('.')].join('.');

const STATUS_ALIASES = {
  pending: 'pending',
  in_review: 'pending',
  under_review: 'pending',
  clarification: 'needs_info',
  needs_info: 'needs_info',
  approved: 'live',
  verified: 'live',
  live: 'live',
  rejected: 'rejected',
};

const STATUS_META = {
  pending: { icon: 'clock', labelKey: statusKey('status.pending'), label: 'Under review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  needs_info: { icon: 'alert-circle', labelKey: statusKey('status.needsInfo'), label: 'Needs info', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/20' },
  confirm: { icon: 'user-check', labelKey: statusKey('status.confirm'), label: 'Confirm your listing', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  live: { icon: 'check-circle', labelKey: statusKey('status.live'), label: 'Live', cls: 'text-brand-teal-3 bg-brand-teal/10 border-brand-teal/20' },
  rejected: { icon: 'x-circle', labelKey: statusKey('status.notApproved'), label: 'Not approved', cls: 'text-gray-300 bg-white/5 border-white/10' },
  flagged: { icon: 'clock', labelKey: statusKey('status.underReview'), label: 'Under review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  paused: { icon: 'pause-circle', labelKey: statusKey('status.paused'), label: 'Paused', cls: 'text-slate-300 bg-slate-500/15 border-slate-500/20' },
  sold: { icon: 'party-popper', labelKey: statusKey('status.sold'), label: 'Sold', cls: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/20' },
  rented: { icon: 'party-popper', labelKey: statusKey('status.rented'), label: 'Rented', cls: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/20' },
  archived: { icon: 'folder-lock', labelKey: statusKey('status.archived'), label: 'Archived', cls: 'text-slate-300 bg-slate-500/15 border-slate-500/20' },
  under_offer: { icon: 'handshake', labelKey: statusKey('status.underOffer'), label: 'Under offer', cls: 'text-purple-300 bg-purple-500/15 border-purple-500/20' },
  private: { icon: 'lock', labelKey: statusKey('status.private'), label: 'Private', cls: 'text-gray-300 bg-white/10 border-white/10' },
};

const REASON_DEFAULTS = {
  photos_not_real: 'Photos do not look real for this listing.',
  duplicate: 'This looks like a duplicate listing.',
  broker: 'This appears to be a broker listing.',
  wrong_details: 'Some listing details look incorrect.',
  locality_unclear: 'The locality needs to be clearer.',
  document_unreadable: 'The ownership document is unreadable.',
  name_mismatch: 'The owner name does not match the document.',
  other: 'Our reviewer needs one more detail.',
};

const CLOSED_STATUSES = new Set(['paused', 'sold', 'rented', 'archived', 'under_offer', 'private']);
const REVIEW_ACTION_REASONS = new Set(['document_unreadable', 'name_mismatch']);
const AWAITING_CONFIRM = new Set(['created', 'link_sent']);
const TRACKED_STATES = new Set(['pending', 'needs_info', 'confirm', 'flagged']);

const normalizedStatus = (status) => STATUS_ALIASES[String(status || '').toLowerCase()] || String(status || '').toLowerCase();
const tr = (t, key, defaultValue) => (typeof t === 'function' ? t(key, { defaultValue }) : defaultValue);

export function getOwnerListingState(listing = {}, review = null) {
  const listingStatus = normalizedStatus(listing.status);
  if (listing.archived || listing.isArchived) return 'archived';
  if (listingStatus === 'flagged') return 'flagged';
  if (CLOSED_STATUSES.has(listingStatus)) return listingStatus;
  const reviewStatus = normalizedStatus(review?.status || listing.reviewStatus || listing.verificationStatus);
  if (reviewStatus === 'needs_info') return 'needs_info';
  if (reviewStatus === 'rejected' || listingStatus === 'rejected') return 'rejected';
  if (listingStatus === 'pending' && listing.progress?.track === 'staff' && AWAITING_CONFIRM.has(listing.progress.step)) return 'confirm';
  if (listingStatus === 'live' || (reviewStatus === 'live' && listingStatus !== 'pending')) return 'live';
  return 'pending';
}

export function getOwnerListingStatusMeta(listing = {}, review = null, t = (key, opts) => opts?.defaultValue || key) {
  const state = getOwnerListingState(listing, review);
  const meta = STATUS_META[state] || STATUS_META.pending;
  return {
    state,
    icon: meta.icon,
    cls: meta.cls,
    label: tr(t, meta.labelKey, meta.label),
  };
}

const hasBadgeRequest = (listing = {}) => Boolean(listing.ownershipVerified || seeksOwnershipBadge(listing));
const badgeHref = (listing = {}) => `/dashboard?tab=documents&prop=${encodeURIComponent(listing.uuid || listing.id || '')}`;

const reasonText = (t, review = {}) => {
  const code = review?.reasonCode || review?.reason || review?.reason_code;
  const fallback = REASON_DEFAULTS[code] || REASON_DEFAULTS.other;
  const reason = code
    ? tr(t, statusKey(`reasons.${code}`), fallback)
    : tr(t, statusKey('reasons.other'), fallback);
  return [reason, review?.reasonNote || review?.reason_note || review?.lastMessage].filter(Boolean).join(' ');
};

const statusLine = (state, t, review) => {
  if (state === 'needs_info') return reasonText(t, review);
  if (state === 'rejected') return reasonText(t, review);
  const lines = {
    pending: [statusKey('line.pending'), 'Our team usually reviews listings within 24 hours.'],
    confirm: [statusKey('line.confirm'), 'Draazy posted this for you. Check the details — it goes live only after you confirm.'],
    flagged: [statusKey('line.underReview'), 'This listing is off search while Draazy reviews it.'],
    live: [statusKey('line.live'), 'Buyers can now find and contact you.'],
    paused: [statusKey('line.paused'), 'This listing is paused.'],
    sold: [statusKey('line.sold'), 'This listing is marked sold.'],
    rented: [statusKey('line.rented'), 'This listing is marked rented.'],
    archived: [statusKey('line.archived'), 'This listing is archived.'],
    under_offer: [statusKey('line.underOffer'), 'This listing is under offer.'],
    private: [statusKey('line.private'), 'This listing is private.'],
  };
  const [key, fallback] = lines[state] || lines.pending;
  return tr(t, key, fallback);
};

const actionFor = ({ state, listing, review, editHref, viewHref, supportHref, onOpenReview, onShare, onConfirm, t }) => {
  const badgeRequested = hasBadgeRequest(listing);
  const verified = Boolean(listing?.ownershipVerified);
  if (state === 'confirm' && onConfirm) {
    return { kind: 'button', onClick: onConfirm, icon: 'check-circle', label: tr(t, statusKey('actions.confirm'), 'Yes, this is my property'), testId: 'confirm-listing' };
  }
  if (state === 'pending') {
    return badgeRequested
      ? { kind: 'link', href: viewHref, icon: 'eye', label: tr(t, statusKey('actions.view'), 'View listing') }
      : { kind: 'link', href: badgeHref(listing), icon: 'shield-check', label: tr(t, statusKey('actions.getBadge'), 'Get Verified property badge') };
  }
  if (state === 'needs_info') {
    const useThread = REVIEW_ACTION_REASONS.has(review?.reasonCode || review?.reason || review?.reason_code) && onOpenReview;
    return useThread
      ? { kind: 'button', onClick: onOpenReview, icon: 'message-square', label: tr(t, statusKey('actions.fixNow'), 'Fix now') }
      : { kind: 'link', href: editHref, icon: 'edit', label: tr(t, statusKey('actions.fixNow'), 'Fix now') };
  }
  if (state === 'live') {
    if (!verified && !badgeRequested) return { kind: 'link', href: badgeHref(listing), icon: 'shield-check', label: tr(t, statusKey('actions.getBadge'), 'Get Verified property badge') };
    return onShare
      ? { kind: 'button', onClick: onShare, icon: 'share-2', label: tr(t, statusKey('actions.share'), 'Share listing') }
      : { kind: 'link', href: viewHref, icon: 'eye', label: tr(t, statusKey('actions.view'), 'View listing') };
  }
  if (state === 'rejected') {
    return { kind: 'link', href: supportHref, icon: 'life-buoy', label: tr(t, statusKey('actions.contactSupport'), 'Contact support') };
  }
  return { kind: 'link', href: viewHref, icon: 'eye', label: tr(t, statusKey('actions.view'), 'View listing') };
};

function Action({ action, secondary = false }) {
  const cls = secondary
    ? 'min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:text-white'
    : 'min-h-[44px] flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-teal-1';
  if (action.kind === 'button') {
    return (
      <button type="button" onClick={action.onClick} data-testid={action.testId} className={cls}>
        <Icon name={action.icon} className="w-3.5 h-3.5" /> {action.label}
      </button>
    );
  }
  return (
    <Link to={action.href} data-testid={action.testId} className={cls}>
      <Icon name={action.icon} className="w-3.5 h-3.5" /> {action.label}
    </Link>
  );
}

export default function ListingStatusCard({
  listing,
  review,
  variant = 'slim',
  editHref,
  viewHref,
  supportHref = '/support',
  onOpenReview,
  onShare,
  onConfirm,
  t,
  className = '',
}) {
  const meta = getOwnerListingStatusMeta(listing, review, t);
  const unread = Number(review?.unread) || 0;
  const compact = variant === 'slim';
  const action = actionFor({ state: meta.state, listing, review, editHref, viewHref, supportHref, onOpenReview, onShare, onConfirm, t });
  const reportWrong = meta.state === 'confirm' && onConfirm
    ? { kind: onOpenReview ? 'button' : 'link', onClick: onOpenReview, href: supportHref, icon: 'alert-circle', label: tr(t, statusKey('actions.reportWrong'), "Something's wrong"), testId: 'report-listing-wrong' }
    : null;
  const line = statusLine(meta.state, t, review);
  const badgeLabel = tr(t, statusKey('badge'), 'Verified property');
  const wrapper = compact
    ? 'rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3'
    : 'rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left';

  return (
    <div data-testid="listing-status-card" className={`${wrapper} ${className}`}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className={`relative inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.cls}`}>
              <Icon name={meta.icon} className="h-3 w-3" /> {meta.label}
              {unread ? <span aria-hidden="true" className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{unread}</span> : null}
            </span>
            {listing?.ownershipVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-teal/25 bg-brand-teal/10 px-2.5 py-1 text-[11px] font-semibold text-brand-teal-3">
                <Icon name="shield-check" className="h-3 w-3" /> {badgeLabel}
              </span>
            ) : seeksOwnershipBadge(listing) ? (
              <span data-testid="badge-under-review" className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                <Icon name="clock" className="h-3 w-3" /> {tr(t, statusKey('badgeUnderReview'), 'Badge under review')}
              </span>
            ) : listing?.ownershipDeclinedReason ? (
              <span data-testid="badge-declined" title={listing.ownershipDeclinedReason} className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300">
                <Icon name="alert-circle" className="h-3 w-3" /> {tr(t, statusKey('badgeDeclined'), 'Badge not granted')}
              </span>
            ) : null}
            <p className="text-xs leading-relaxed text-gray-300">{line}</p>
          </div>
          {TRACKED_STATES.has(meta.state) ? <ProgressTracker progress={listing?.progress} ownerView className="mt-2" /> : null}
          {onOpenReview && review?.lastMessage ? (
            <button type="button" onClick={onOpenReview} data-testid="support-thread-link" className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-brand-teal-3 hover:underline">
              <Icon name="message-square" className="h-3.5 w-3.5" /> {tr(t, statusKey('actions.supportMessages'), 'Messages from Draazy Support')}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
          <Action action={action} />
          {reportWrong ? <Action action={reportWrong} secondary /> : null}
        </div>
      </div>
    </div>
  );
}
