import { Link } from 'react-router';
import Icon from '../../../../components/Icon.jsx';
import { fmtINR, fmtNum } from '../../../../lib/format.js';
import { computeQualityScore, qualityTips, qualityColor } from '../../../../lib/qualityScore.js';
import { listingFreshness } from '../../../../lib/freshness.js';
import { canSplitIntoRooms } from '../../../../lib/data/flatSplit.js';
import StatChip from './StatChip.jsx';
import { renderOverflow } from './OverflowActions.jsx';
import { isFeaturedActive } from '../../../../lib/featured.js';
import {
  FALLBACK_IMG, FURNISH_LABEL, LISTING_STATUS_CLS, STATUS_LABEL, STATUS_ICON,
  FRESHNESS_ICON, primaryCls, quietCls,
} from './helpers.js';

// A single live/posted listing row: identity + status pills, the performance
// strip, and the action row (one primary, quiet everyday actions, rest in More).
//
// `dealStatus` is supplied by the panel from one `/me/deals` read rather than looked up per card.
// The deal endpoints are owner-scoped and asynchronous, so a card cannot answer this for itself
// without a request of its own — which on a twenty-listing dashboard is twenty requests.
//
// `review` arrives the same way and for the same reason, from one `/me/property-reviews` read: a
// row of `{ status, unread, updatedAt }`, or `null` for a listing never submitted for verification.
// It used to be a synchronous localStorage lookup here — against a store the ops desk never wrote
// to, so an owner and the reviewer had never once seen the same case file.
//
// `split` is the third of these: `{ rooms, movedIn }` for a flat being let room by room, or `null`.
// It replaces three synchronous `lib/data/flatSplit.js` calls that read `puneNestRoomListings` —
// this browser's own store, which the API does not write. A split performed against the server
// therefore never appeared here at all.
export default function ListingCard({
  l, user, dealStatus = 'active', review = null, split = null, leadsFor, featuringOn, canFeature,
  navigate, openReview,
  onConfirmFresh, onReopen, onMarkUnderOffer, onFinalize, onToggleFeature, onDelete,
  onSplit, onUnsplit,
}) {
  const unread = review?.unread || 0;
  const closed = dealStatus === 'closed';
  const reserved = dealStatus === 'reserved';
  const isSale = l.deal === 'buy' || l.deal === 'sale';
  const displayStatus = closed ? (isSale ? 'sold' : 'rented') : reserved ? 'under_offer' : l.status;
  const fr = !l.flatmate && !closed ? listingFreshness(l) : null;
  const leads = !l.flatmate ? leadsFor(l.id) : 0;
  const qScore = !l.flatmate ? computeQualityScore(l) : 0;
  const qMeta = !l.flatmate ? qualityColor(qScore) : null;
  const qTone = qScore >= 80 ? 'emerald' : qScore >= 60 ? 'amber' : 'rose';
  const specs = [
    l.bhk && `${l.bhk} BHK`,
    l.furnishing && (FURNISH_LABEL[String(l.furnishing).toLowerCase()] || l.furnishing),
  ].filter(Boolean).join(' · ');

  // One status truth: the lifecycle pill is always primary (Live / Under
  // review / Under Offer / Sold / Rented). It stays clickable to open the
  // verification thread when one exists, so we never duplicate it.
  const hasReview = !closed && !reserved && !!review;
  const statusPill = {
    label: STATUS_LABEL[displayStatus] || displayStatus,
    cls: LISTING_STATUS_CLS[displayStatus] || 'bg-white/10 text-gray-300',
    icon: STATUS_ICON[displayStatus],
    onClick: hasReview ? () => openReview(l.id) : undefined,
  };
  // Verification only earns its own chip when it says something the
  // lifecycle pill can't: needs your input, was rejected, or passed.
  let reviewChip = null;
  if (hasReview) {
    /* "Action needed" is derived from the thread, not from a status.

       The mock had a `clarification` status that it set whenever ops posted a message; the server
       has no such value, and rightly — it was a fact about the *conversation* stored as a fact
       about the case. Unread ops messages say the same thing directly, and unlike a status they
       clear themselves when the owner reads them. */
    if (unread > 0) reviewChip = { label: 'Action needed', cls: 'bg-rose-500/15 text-rose-300', icon: 'alert-circle' };
    else if (review.status === 'rejected') reviewChip = { label: 'Rejected', cls: 'bg-rose-500/15 text-rose-300', icon: 'x-circle' };
    else if (review.status === 'approved') reviewChip = { label: 'Verified', cls: 'bg-emerald-500/15 text-emerald-300', icon: 'shield-check' };
  }
  const StatusTag = statusPill.onClick ? 'button' : 'span';
  /* Letting room by room is only offered on a rent listing the owner already has
     live — that's what supplies the verified propertyId every room inherits, and
     what keeps the whole-flat listing in place rather than replacing it. */
  const splitEligible = !l.flatmate && !closed && !reserved && canSplitIntoRooms(l);
  const isSplit = splitEligible && !!split;
  const splitRooms = isSplit ? split.rooms : 0;
  const movedIn = isSplit ? split.movedIn : 0;
  const editHref = l.flatmateGroup ? '/flatmates?view=team-up' : l.flatmatePost ? '/flatmates' : l.flatmate ? '/list-property?flatmate=1' : `/list-property?edit=${l.id}`;
  const viewHref = l.flatmateGroup ? '/flatmates?view=team-up' : l.flatmate ? '/flatmates' : `/property/${l.id}`;
  // Days remaining on the free first-verify Featured perk, for the badge tooltip/label.
  const featuredDaysLeft = l.featuredUntil ? Math.max(0, Math.ceil((l.featuredUntil - Date.now()) / 86400000)) : 0;

  // One prominent primary action, chosen by what the owner most needs to do next.
  let primary = null;
  if (fr && fr.owner.cta === 'confirm') primary = { label: 'Confirm available', icon: 'check-circle', tone: 'emerald', onClick: () => onConfirmFresh(l) };
  else if (fr && fr.owner.cta === 'reactivate') primary = { label: 'Reactivate', icon: 'refresh-cw', tone: 'emerald', onClick: () => onConfirmFresh(l) };
  else if (closed) primary = { label: 'Reopen listing', icon: 'rotate-ccw', tone: 'teal', onClick: () => onReopen(l) };
  else if (!l.flatmate && leads > 0) primary = { label: `View ${leads} lead${leads > 1 ? 's' : ''}`, icon: 'users-round', tone: 'teal', onClick: () => navigate('/dashboard#leads') };

  // Low-frequency + destructive actions fold into the "More" bucket.
  const featureItem = (!l.flatmate && featuringOn && l.status === 'approved')
    ? (canFeature
        ? { icon: 'star', label: l.featured ? 'Remove from featured' : 'Feature listing', onClick: () => onToggleFeature(l) }
        : (l.featured
            ? { icon: 'star', label: 'Featured by PuneNest', disabled: true }
            : { icon: 'star', label: 'Feature — upgrade', to: '/plans' }))
    : null;
  /* A "WhatsApp reminder" button stood here, shown on the same two states (`stale`, `dormant`)
     that put `Confirm available` / `Reactivate` in `primary` above. It opened a `wa.me` link to a
     platform-signed chaser asking the owner to reply "YES" to reconfirm availability — on the
     owner's own dashboard, addressed to the owner's own number. There was nobody on the other end
     of that thread, and the one-tap control that actually performs the reconfirmation was already
     a few pixels to its left. Register item 28, option (1). */
  const overflowActions = [
    (!l.flatmate && !closed && !reserved && l.status === 'approved') && { icon: 'handshake', label: 'Mark under offer', onClick: () => onMarkUnderOffer(l) },
    (!l.flatmate && !closed && (reserved || l.status === 'approved')) && { icon: 'check-circle', label: `Finalize ${isSale ? 'sale' : 'rental'}`, onClick: () => onFinalize(l) },
    // Splitting is reversible only while the flat is still empty — once someone
    // has moved in, withdrawing the rooms would erase a live tenancy.
    (splitEligible && !isSplit) && { icon: 'layout-grid', label: 'Let room by room', onClick: () => onSplit && onSplit(l) },
    (isSplit && movedIn === 0) && { icon: 'undo-2', label: 'Stop letting room by room', onClick: () => onUnsplit && onUnsplit(l) },
    featureItem,
  ].filter(Boolean);
  const overflowItems = [
    ...overflowActions,
    overflowActions.length > 0 && { divider: true },
    /* "Take down", not "Delete". The server soft-archives (`DELETE /me/listings/{id}`) so the
       enquiries and deals pointing at the listing survive, and the owner can list it again. Calling
       that Delete promised an erasure the product does not perform and made the one exit from the
       free-tier listing quota read as the most destructive thing on the menu. */
    { icon: 'trash-2', label: l.flatmate || l.flatmatePost || l.flatmateGroup ? 'Delete' : 'Take down', tone: 'danger', onClick: () => onDelete(l) },
  ];

  return (
    <div className="rounded-xl bg-white/[0.03] overflow-hidden">
      <div className="flex items-start gap-3 p-4 sm:gap-4">
        <img src={l.image || FALLBACK_IMG} alt={l.title} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 sm:w-20 sm:h-20 sm:rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <p className="text-white text-sm font-semibold sm:truncate">{l.title}</p>
            {!l.flatmate && specs && <p className="text-gray-500 text-[11px] mt-0.5">{specs}</p>}
            <p className="text-xs mt-0.5">
              {l.locality && <span className="text-gray-500">{l.locality} · </span>}
              <span className="text-white font-semibold">{fmtINR(l.price)}{l.deal === 'rent' ? '/mo' : ''}</span>
            </p>
            {l.flatmate && (
              <div className="mt-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold inline-flex items-center gap-1"><Icon name="users-round" className="w-3 h-3" /> {l.flatmateGroup ? 'Flatmate group' : l.flatmatePost ? 'Flatmate request' : 'Flatmate'}</span>
              </div>
            )}
            {/* Once someone moves into a room the flat can no longer be let whole,
                so the whole-flat listing is pulled from public search. Saying so
                here is the difference between a feature and a silent disappearance. */}
            {isSplit && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold inline-flex items-center gap-1"><Icon name="layout-grid" className="w-3 h-3" /> {splitRooms} room{splitRooms > 1 ? 's' : ''} listed</span>
                {movedIn > 0
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-semibold inline-flex items-center gap-1"><Icon name="eye-off" className="w-3 h-3" /> {movedIn} moved in · whole-flat listing hidden</span>
                  : <span className="text-[10px] text-gray-500">Whole-flat listing still live</span>}
              </div>
            )}
          </div>
          <div className="flex flex-row flex-wrap items-center gap-1.5 sm:flex-col sm:items-end sm:flex-shrink-0">
            <StatusTag
              type={statusPill.onClick ? 'button' : undefined}
              onClick={statusPill.onClick}
              title={statusPill.onClick ? 'Open the verification review for this listing' : undefined}
              aria-label={statusPill.onClick && unread ? `${statusPill.label} — ${unread} unread verification message${unread > 1 ? 's' : ''}` : undefined}
              className={'relative text-[11px] px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1 ' + statusPill.cls + (statusPill.onClick ? ' hover:brightness-110 transition' : '')}
            >
              <Icon name={statusPill.icon} className="w-3 h-3" /> {statusPill.label}
              {statusPill.onClick && unread ? <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">{unread}</span> : null}
            </StatusTag>
            {reviewChip && (
              <button
                type="button"
                onClick={() => openReview(l.id)}
                title="Open the verification review for this listing"
                aria-label={`${reviewChip.label} — open verification review`}
                className={'text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 hover:brightness-110 transition ' + reviewChip.cls}
              >
                <Icon name={reviewChip.icon} className="w-3 h-3" /> {reviewChip.label}
              </button>
            )}
            {/* recheckPending is the server's answer and reReview the mock store's; neither provider
                emits both, so the chip needs both names to appear in both modes. Until D218 this
                read `reReview` alone, which the http mapper never sets — so against the live API the
                owner of a listing under re-check was told nothing at all. */}
            {(l.recheckPending || l.reReview) && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold inline-flex items-center gap-1" title={l.recheckReason ? `Being re-checked: ${l.recheckReason}. Your listing stays live.` : 'Core details you edited are being re-checked. Your listing stays live.'}>
                <Icon name="history" className="w-3 h-3" /> Update under review
              </span>
            )}
            {l.priceReduced && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold inline-flex items-center gap-1">
                <Icon name="trending-down" className="w-3 h-3" /> Price reduced
              </span>
            )}
            {l.featuredReason === 'first-verify' && isFeaturedActive(l) && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-semibold inline-flex items-center gap-1"
                title={`Free 7-day Featured boost for getting Verified${featuredDaysLeft ? ` — ${featuredDaysLeft} day${featuredDaysLeft > 1 ? 's' : ''} left` : ''}. Featured listings appear at the top of search.`}
              >
                <Icon name="star" className="w-3 h-3" /> Featured · free{featuredDaysLeft ? ` · ${featuredDaysLeft}d left` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Performance strip — one uniform chip language: what buyers see, at a glance. */}
      {!l.flatmate && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 px-4 py-3 border-t border-white/6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1">
          <StatChip icon="eye" value={fmtNum(l.views || 0)} label="Views" title="Times buyers opened this listing" />
          <StatChip
            icon="users-round"
            value={leads}
            label={leads === 1 ? 'Lead' : 'Leads'}
            tone={leads > 0 ? 'teal' : 'muted'}
            onClick={leads > 0 ? () => navigate('/dashboard#leads') : undefined}
            title={leads > 0 ? 'Buyers who requested your contact' : 'No leads yet'}
            ariaLabel={leads > 0 ? `View ${leads} lead${leads > 1 ? 's' : ''}` : undefined}
          />
          {fr && (
            <StatChip
              icon={FRESHNESS_ICON[fr.state]}
              value={fr.owner.label}
              label="Availability"
              tone={fr.owner.tone === 'gray' ? 'muted' : fr.owner.tone}
              title={fr.state === 'active' ? 'Buyers see this as actively managed' : `Last confirmed available ${fr.since}`}
            />
          )}
          <StatChip icon="gauge" value={`${qScore}/100`} label={qMeta?.label || 'Quality'} tone={qTone} title={`Listing quality: ${qScore}/100`} />
        </div>
      )}

      {/* Action row — one primary, quiet everyday actions, the rest in More. */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/6 flex-wrap">
        {primary && (
          <button onClick={primary.onClick} className={primaryCls(primary.tone)}>
            <Icon name={primary.icon} className="w-3.5 h-3.5" /> {primary.label}
          </button>
        )}
        <Link to={editHref} className={quietCls}>
          <Icon name="edit" className="w-3.5 h-3.5" /> Edit
        </Link>
        <Link to={viewHref} className={quietCls}>
          <Icon name="eye" className="w-3.5 h-3.5" /> View
        </Link>
        {!l.flatmate && l.managedId && (
          <Link to={`/owner-hub/property/${l.managedId}`} className="text-[11px] px-3 py-1.5 rounded-lg bg-brand-teal/10 text-brand-teal-3 font-semibold hover:bg-brand-teal/20 inline-flex items-center gap-1 transition-colors" title="Valuation, document passport & rent tracking for this property">
            <Icon name="gauge" className="w-3.5 h-3.5" /> Tools{typeof l.passportPct === 'number' ? ` · ${l.passportPct}%` : ''}
          </Link>
        )}
        {renderOverflow(overflowItems, navigate)}
      </div>
      {!l.flatmate && qScore < 80 && (
        <div className="px-4 pb-4">
          <div className="border-l-2 border-amber-500/40 pl-3">
            <p className="text-[11px] font-semibold text-amber-300 mb-1 inline-flex items-center gap-1"><Icon name="sparkles" className="w-3.5 h-3.5" /> Lift your score to reach more buyers:</p>
            <ul className="text-[10px] text-gray-400 space-y-0.5">
              {qualityTips(l).slice(0, 3).map((tip) => <li key={tip}>• {tip}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
