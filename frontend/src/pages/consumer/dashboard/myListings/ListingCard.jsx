import Icon from '../../../../components/Icon.jsx';
import PropertyImage from '../../../../components/ui/PropertyImage.jsx';
import ListingStatusCard, { getOwnerListingStatusMeta } from '../../../../components/listing/ListingStatusCard.jsx';
import { fmtINR, fmtNum } from '../../../../lib/format.js';
import { onlySeeksOwnershipBadge } from '../../../../lib/recheckFields.js';
import { computeQualityScore, qualityTips, qualityColor } from '../../../../lib/qualityScore.js';
import { listingFreshness } from '../../../../lib/freshness.js';
import { canSplitIntoRooms } from '../../../../lib/data/flatSplit.js';
import { detailPath, roomEditHref } from '../../flatmates/helpers.js';
import StatChip from './StatChip.jsx';
import CardActions from './CardActions.jsx';
import {
  FURNISH_LABEL, LISTING_STATUS_CLS, STATUS_LABEL, STATUS_ICON, FRESHNESS_ICON,
} from './helpers.js';
// The panel supplies review and split data in bulk to avoid per-card requests.

export default function ListingCard({
  l, review = null, split = null,
  navigate, openReview,
  onConfirmFresh, onConfirmListing, onReopen, onMarkUnderOffer, onFinalize, onDelete,
  onSplit, onUnsplit, onPause, onResume, onShare, onOpenTools, onEditGroup, onEditPost, onRenew, t,
}) {
  const unread = review?.unread || 0;
  const dealStatus = l.dealStatus || 'active';
  const closed = dealStatus === 'closed';
  const reserved = dealStatus === 'reserved';
  const isSale = l.deal === 'buy' || l.deal === 'sale';
  const displayStatus = closed ? (isSale ? 'sold' : 'rented') : reserved ? 'under_offer' : l.status;
  // Freshness describes availability, not approval; unapproved listings cannot be reactivated.
  const fr = !l.flatmate && !closed && l.status === 'approved' ? listingFreshness(l) : null;
  const leads = !l.flatmate ? l.pendingLeads || 0 : 0;
  const qScore = !l.flatmate ? computeQualityScore(l) : 0;
  const qMeta = !l.flatmate ? qualityColor(qScore) : null;
  const qTone = qScore >= 80 ? 'emerald' : qScore >= 60 ? 'amber' : 'rose';
  const specs = [
    l.bhk && `${l.bhk} BHK`,
    l.furnishing && (FURNISH_LABEL[String(l.furnishing).toLowerCase()] || l.furnishing),
  ].filter(Boolean).join(' · ');
  // Keep lifecycle primary, with the same pill opening its verification thread.

  const hasReview = !closed && !reserved && !!review;
  const ownerStatusMeta = !l.flatmate && !closed && !reserved ? getOwnerListingStatusMeta(l, review, t) : null;
  const finalRejected = ownerStatusMeta?.state === 'rejected';
  const statusPill = ownerStatusMeta ? null : {
    label: STATUS_LABEL[displayStatus] || displayStatus,
    cls: LISTING_STATUS_CLS[displayStatus] || 'bg-white/10 text-gray-300',
    icon: STATUS_ICON[displayStatus],
    onClick: hasReview ? () => openReview(l.id) : undefined,
  };
  // Rooms inherit the verified property identity from an already-live rent listing.
  // Verification gets a chip only when the lifecycle pill cannot say enough.
  const StatusTag = statusPill?.onClick ? 'button' : 'span';
  const splitEligible = !l.flatmate && !closed && !reserved && canSplitIntoRooms(l);
  const isSplit = splitEligible && !!split;
  const splitRooms = isSplit ? split.rooms : 0;
  const movedIn = isSplit ? split.movedIn : 0;
  // Days remaining on the free first-verify Featured perk, for the badge tooltip/label.
  const flatmateKind = l.flatmateGroup ? 'group' : l.flatmatePost ? 'post' : l.flatmate ? 'room' : null;
  const editHref = `/list-property?edit=${l.id}`;
  const viewHref = flatmateKind ? detailPath(flatmateKind, l.id) : `/property/${l.id}`;
  const editAction = l.flatmateGroup
    ? { icon: 'edit', label: 'Edit', onClick: () => onEditGroup(l.id) }
    : l.flatmatePost
      ? { icon: 'edit', label: 'Edit', onClick: () => onEditPost(l.id) }
      : flatmateKind === 'room'
        ? (l.propertyId ? null : { icon: 'edit', label: 'Edit', to: roomEditHref(l.id) })
        : { icon: 'edit', label: 'Edit', to: editHref };
  // One prominent primary action, chosen by what the owner most needs to do next.

  let primary = null;
  if (flatmateKind && l.status === 'expired') primary = { label: 'Renew for 30 days', icon: 'refresh-cw', tone: 'emerald', onClick: () => onRenew(flatmateKind, l) };
  else if (!l.flatmate && l.status === 'paused') primary = { label: t('listingLifecycle.resume'), icon: 'play-circle', tone: 'emerald', onClick: () => onResume(l) };
  else if (fr && fr.owner.cta === 'confirm') primary = { label: 'Confirm available', icon: 'check-circle', tone: 'emerald', onClick: () => onConfirmFresh(l) };
  else if (fr && fr.owner.cta === 'reactivate') primary = { label: 'Reactivate', icon: 'refresh-cw', tone: 'emerald', onClick: () => onConfirmFresh(l) };
  else if (closed) primary = { label: 'Reopen listing', icon: 'rotate-ccw', tone: 'teal', onClick: () => onReopen(l) };
  else if (!l.flatmate && leads > 0) primary = { label: `${leads} waiting`, icon: 'users-round', tone: 'teal', onClick: () => navigate('/dashboard#leads') };
  // Rental room management stays visible; unrelated low-frequency actions use "More".

  const roomAction = (splitEligible && !isSplit)
    ? { icon: 'layout-grid', label: 'Let room by room', onClick: () => onSplit && onSplit(l) }
    : (isSplit && movedIn === 0)
      ? { icon: 'undo-2', label: 'Stop letting room by room', onClick: () => onUnsplit && onUnsplit(l) }
      : null;
  const withdrawAction = {
    icon: 'trash-2',
    label: l.status === 'approved' ? 'Take down' : 'Withdraw',
    tone: 'danger',
    onClick: () => onDelete(l),
  };
  const viewAction = { icon: 'eye', label: 'View listing', to: viewHref };
  const toolsAction = !l.flatmate
    ? {
        icon: 'gauge',
        label: `Tools${typeof l.passportPct === 'number' ? ` · ${l.passportPct}%` : ''}`,
        onClick: () => onOpenTools?.(l),
      }
    : null;
  const cardActions = [
    !finalRejected && editAction,
    viewAction,
    toolsAction,
    roomAction,
    (!l.flatmate && !closed && !reserved && l.status === 'approved') && { icon: 'handshake', label: 'Mark under offer', onClick: () => onMarkUnderOffer(l) },
    (!l.flatmate && !closed && (reserved || l.status === 'approved')) && { icon: 'check-circle', label: `Finalize ${isSale ? 'sale' : 'rental'}`, onClick: () => onFinalize(l) },
    (!l.flatmate && !closed && !reserved && l.status === 'approved') && { icon: 'pause-circle', label: t('listingLifecycle.pause'), onClick: () => onPause(l) },
    (l.flatmate || l.flatmatePost || l.flatmateGroup
      ? { icon: 'trash-2', label: 'Delete', tone: 'danger', onClick: () => onDelete(l) }
      : withdrawAction),
  ];
  const recheckReason = l.recheckReason || 'Core details you edited are being re-checked. Your listing stays live.';

  return (
    <div className="rounded-xl bg-white/[0.03] overflow-hidden">
      <div className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
        <PropertyImage src={l.image} alt={l.title} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 sm:w-20 sm:h-20 sm:rounded-lg" />
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
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold inline-flex items-center gap-1"><Icon name="users-round" className="w-3 h-3" /> {l.flatmateGroup ? 'Flatmate group' : l.flatmatePost ? 'Flatmate request' : 'Flatmate'}</span>
              </div>
            )}
            {/* An occupied room prevents offering the whole flat. */}
            {isSplit && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold inline-flex items-center gap-1"><Icon name="layout-grid" className="w-3 h-3" /> {splitRooms} room{splitRooms > 1 ? 's' : ''} listed</span>
                {movedIn > 0
                  ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-semibold inline-flex items-center gap-1"><Icon name="eye-off" className="w-3 h-3" /> {movedIn} moved in · whole-flat listing hidden</span>
                  : <span className="text-xs text-gray-500">Whole-flat listing still live</span>}
              </div>
            )}
          </div>
          <div className="flex flex-row flex-wrap items-center gap-1.5 sm:flex-col sm:items-end sm:flex-shrink-0">
            {statusPill && (
              <StatusTag
                type={statusPill.onClick ? 'button' : undefined}
                onClick={statusPill.onClick}
                title={statusPill.onClick ? 'Open the verification review for this listing' : undefined}
                aria-label={statusPill.onClick && unread ? `${statusPill.label} — ${unread} unread verification message${unread > 1 ? 's' : ''}` : undefined}
                className={'relative text-[13px] px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1 ' + statusPill.cls + (statusPill.onClick ? ' hover:brightness-110 transition' : '')}
              >
                <Icon name={statusPill.icon} className="w-3 h-3" /> {statusPill.label}
                {statusPill.onClick && unread ? <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center font-bold">{unread}</span> : null}
              </StatusTag>
            )}
            {/* Rechecking an edit does not take the original listing offline. */}
            {((l.recheckPending && !onlySeeksOwnershipBadge(l)) || l.reReview) && (
              <div className="w-full sm:max-w-[16rem]">
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold inline-flex items-center gap-1">
                  <Icon name="history" className="w-3 h-3" /> Update under review
                </span>
                <p className="mt-1 text-xs leading-snug text-amber-100/80">{recheckReason}</p>
              </div>
            )}
            {l.priceReduced && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold inline-flex items-center gap-1">
                <Icon name="trending-down" className="w-3 h-3" /> Price reduced
              </span>
            )}
          </div>
        </div>
      </div>

      {!l.flatmate && !closed && !reserved && (
        <div className="px-3 pb-3 sm:px-4">
          <ListingStatusCard
            listing={l}
            review={review}
            variant="slim"
            editHref={`${editHref}&step=photos`}
            viewHref={viewHref}
            onOpenReview={hasReview ? () => openReview(l.id) : undefined}
            onShare={onShare ? () => onShare(l, viewHref) : undefined}
            onConfirm={onConfirmListing ? () => onConfirmListing(l) : undefined}
            t={t}
          />
        </div>
      )}

      {/* Performance strip — one uniform chip language: what buyers see, at a glance. */}
      {!l.flatmate && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 px-3 py-3 border-t sm:px-4 border-white/6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1">
          <StatChip icon="eye" value={fmtNum(l.views || 0)} label="Views" title="Times buyers opened this listing" />
          <StatChip
            icon="users-round"
            value={leads}
            label={leads === 1 ? 'Lead' : 'Leads'}
            tone={leads > 0 ? 'teal' : 'muted'}
            onClick={leads > 0 ? () => navigate('/dashboard#leads') : undefined}
            title={leads > 0 ? 'Buyers who requested your contact' : 'No leads yet'}
            ariaLabel={leads > 0 ? `View ${leads} waiting lead${leads > 1 ? 's' : ''}` : undefined}
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

        {/* The badge documents live on the wizard's photos step, so verifying after posting is the same edit the
           owner could have made at the time — not a second upload surface. */}
        {/* edit */}
      {/* Action row keeps rental management beside the verification entry point. */}
      <CardActions primary={primary} items={cardActions} />
      {!l.flatmate && qScore < 80 && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
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
