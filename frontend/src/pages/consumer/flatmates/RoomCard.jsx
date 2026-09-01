import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { shareOrCopy } from '../../../lib/share.js';
import { inr, genderPref, foodLabel, matchTier, seatsLeft, hostTierMeta, showHostBadge, moveInLabel } from './helpers.js';
import { roomKindOf, occupancyOf, filledSeatsOf, priceBasisOf, perPersonRent, PRICE_ROOM, OCCUPANCY_EMPTY, OCCUPANCY_OCCUPIED } from './model.js';
import { Chip, MatchPill, Fresh } from './atoms.jsx';

function RoomCard({ r, i, saved, onSave, interested, onInterest, onReport, anchorId, myPost, owned, onSeats, onPeople, onReissue, reviewStatus }) {
  const { t: tr } = useTranslation();
  const tier = matchTier(r, myPost);
  // Owner tier is earned once Ops verifies the listing docs (r.verified); tenant
  // tier is a self-claim that earns its badge only after Ops approves the uploaded
  // agreement (reviewStatus). The Ops queue state is shown separately below.
  const tierMeta = showHostBadge(r, reviewStatus, !!r.verified) ? hostTierMeta(r) : null;
  const hasSeats = r.seatsOpen != null;
  const left = hasSeats ? seatsLeft(r) : null;
  /* Whether anyone lives here yet. A spare room in an occupied flat and a room in
     a vacant flat the owner is letting piece-by-piece are priced alike but are NOT
     the same decision — in the first the household meets and vets you, in the
     second your future flatmates are simply undecided. Showing them identically
     would mislead, so the state is disclosed in full rather than tagged. */
  const occupancy = occupancyOf(r);
  const filled = r.flatCommitted != null ? r.flatCommitted : filledSeatsOf(r);
  const kind = roomKindOf(r);
  /* Per-ROOM pricing: the owner sets one rent for the room and tenants decide
     whether to take it alone or split it, so the headline number is the room's
     rent and the per-person price is derived. `shareMax` already accounts for
     both the per-room ceiling and whatever the flat's occupancy cap has left. */
  const perRoom = priceBasisOf(r) === PRICE_ROOM;
  const shareMax = r.shareMax || 1;
  const canShare = perRoom && shareMax > 1;
  // How the seeker intends to take the room. Sent with the enquiry so the owner
  // knows whether one person or two are coming, and whether we need to find the
  // second one.
  const [share, setShare] = useState('solo');
  const { toast } = useToast();
  /* Forwarding a room. Deliberately NOT named `share` — that is taken above and
     means flat-sharing, an entirely different idea.

     There is no per-room URL: /flatmates is one route. Rather than invent a deep
     link, the URL narrows to the tab and locality the page already honours
     (?view= and ?loc= are read in useFlatmateDiscovery), and the room itself is
     named in the share text. The recipient lands on rooms in the right area with
     the right one named, instead of on an unfiltered national list. */
  const shareRoom = async () => {
    const loc = r.localities?.[0] || '';
    const url = `${window.location.origin}/flatmates?view=move-in${loc ? '&loc=' + encodeURIComponent(loc) : ''}`;
    const label = tr('flatmates.shareRoomText', { society: r.society, locality: loc, price: inr(r.budget) });
    const status = await shareOrCopy({ title: label, text: label, url });
    if (status === 'copied') toast(tr('property.shareCopied'), 'success');
    if (status === 'failed') toast(tr('property.shareCopyFail'), 'error');
  };
  return (
    <div data-sf-id={anchorId} className="sf-card rounded-2xl overflow-hidden reveal flex flex-col" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="relative h-36">
        <img src={r.img} alt={'Room in ' + r.society} className="w-full h-36 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-3 left-3 flex items-center gap-2">{r.verified && <span className="badge-seeker inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('flatmates.verified')}</span>}<MatchPill tier={tier} /><Fresh item={r} /></div>
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button onClick={() => onSave('r:' + r.id)} className={'save-btn seg p-2 rounded-lg bg-black/30 backdrop-blur-md text-gray-200' + (saved ? ' saved' : '')} aria-pressed={saved}><Icon name="bookmark" className="w-4 h-4" /></button>
          <button className="report-btn seg p-2 rounded-lg bg-black/30 backdrop-blur-md text-gray-200" aria-label={tr('flatmates.ariaReportRoom')} onClick={() => onReport && onReport({ id: r.id, title: 'Room in ' + r.society, ownerName: r.society, kind: 'share' })}><Icon name="flag" className="w-4 h-4" /></button>
          <button className="seg p-2 rounded-lg bg-black/30 backdrop-blur-md text-gray-200" aria-label={tr('flatmates.ariaShareRoom')} onClick={shareRoom}><Icon name="share-2" className="w-4 h-4" /></button>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <div className="min-w-0"><p className="text-white font-semibold text-sm leading-tight drop-shadow truncate">{r.society}</p><p className="text-[11px] text-gray-200 inline-flex items-center gap-1"><Icon name="map-pin" className="w-3 h-3 text-teal-300" />{r.localities[0]}</p></div>
        </div>
      </div>
      <div className="p-5 flex flex-col flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-3"><Chip>{r.flatType}</Chip>{kind && <Chip>{tr('flatmates.roomKind_' + kind)}</Chip>}<Chip>{r.roomType}</Chip>{r.homeTypeLabel && r.homeTypeLabel !== 'Flat' && <Chip>{r.homeTypeLabel}</Chip>}{r.gatedCommunity && <Chip>{tr('flatmates.gated')}</Chip>}</div>
        {(tierMeta || reviewStatus || hasSeats) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {tierMeta && <span className={'chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + tierMeta.cls}><Icon name={tierMeta.icon} className="w-2.5 h-2.5" /> {tierMeta.label}</span>}
            {reviewStatus === 'pending' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-amber-300"><Icon name="clock" className="w-2.5 h-2.5" /> {tr('flatmates.pendingOpsReview')}</span>}
            {reviewStatus === 'approved' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('flatmates.opsVerified')}</span>}
            {reviewStatus === 'rejected' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-rose-300"><Icon name="shield-alert" className="w-2.5 h-2.5" /> {tr('flatmates.reviewFailed')}</span>}
            {hasSeats && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-gray-200">{left > 0 ? tr('flatmates.seatsOpen', { count: left }) : tr('flatmates.filled')}</span>}
          </div>
        )}
        {/* Vacant-home disclosure. Deliberately a full-width strip rather than a
            chip: "who will I actually live with" is the single biggest difference
            between these listings, and a chip in a row of six is not a disclosure. */}
        {occupancy !== OCCUPANCY_OCCUPIED && (
          <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300 inline-flex items-center gap-1.5">
              <Icon name="info" className="w-3 h-3" />
              {occupancy === OCCUPANCY_EMPTY ? tr('flatmates.vacantHomeBadge') : tr('flatmates.fillingHomeNote', { count: filled })}
            </p>
            {occupancy === OCCUPANCY_EMPTY && <p className="text-[11px] text-gray-300 mt-1 leading-relaxed">{tr('flatmates.vacantHomeNote')}</p>}
            <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed inline-flex items-start gap-1.5"><Icon name="file-text" className="w-3 h-3 mt-0.5 shrink-0" /> {tr('flatmates.jointAgreementNote')}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mb-1">
          <div><p className="text-[10px] text-gray-500 uppercase tracking-wide">{perRoom ? tr('flatmates.roomRentMo') : tr('flatmates.yourShareMo')}</p><p className="text-lg font-bold gradient-text">{inr(r.budget)}</p></div>
          <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('flatmates.deposit')}</p><p className="text-xs font-medium text-gray-200">{r.deposit ? inr(r.deposit) : '—'}</p></div>
          <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('flatmates.moveIn')}</p><p className="text-xs font-medium text-gray-200">{moveInLabel(r.moveIn)}</p></div>
        </div>
        {/* The split price is stated up front, because the budget filter already
            matched this room on it — a seeker must never have to work out why an
            ₹18,000 room appeared under a ₹10,000 budget. */}
        {canShare && (
          <p className="text-[11px] text-teal-200/90 mb-3 flex items-center gap-1.5 flex-wrap">
            <Icon name="users" className="w-3 h-3 shrink-0" />
            <span>{tr('flatmates.eachIfShare', { price: inr(perPersonRent(r, 2)), count: 2 })}</span>
            {shareMax >= 3 && <span className="text-gray-500">· {tr('flatmates.eachIfShare', { price: inr(perPersonRent(r, 3)), count: 3 })}</span>}
          </p>
        )}
        {!canShare && <div className="mb-3" />}
        <div className="flex flex-wrap gap-1.5 mb-3">{[genderPref(r.gender), foodLabel(r.food), r.furnishing, r.attachedBath === 'attached' ? tr('flatmates.attachedBath') : null].filter(Boolean).map((x) => <Chip key={x}>{x}</Chip>)}</div>
        {r.note && <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-3">"{r.note}"</p>}
        <div className="flex flex-wrap gap-1.5 mb-4">{(r.tags || []).slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}</div>
        {/* Owner controls.

            A per-ROOM listing records who ACTUALLY lives in each room — tenants
            decide how they share, so the owner reports the outcome rather than
            declaring capacity. A legacy spare-room post still uses the older
            open-seats stepper, which is the right model for that case. */}
        {owned && perRoom && (
          <div className="mb-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name="users" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.peopleLivingHere')}</span>
              <div className="inline-flex items-center gap-2">
                <button type="button" onClick={() => onPeople && onPeople(r, -1)} disabled={(r.occupants || 0) <= 0} className="seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaRemovePerson')}><Icon name="minus" className="w-3.5 h-3.5" /></button>
                <span className="text-sm font-bold text-white w-4 text-center" aria-live="polite">{r.occupants || 0}</span>
                <button type="button" onClick={() => onPeople && onPeople(r, 1)} disabled={shareMax <= 0} className="seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaAddPerson')}><Icon name="plus" className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {r.flatMax != null && <p className="text-[11px] text-gray-500 mt-1.5">{tr('flatmates.flatLedger', { committed: r.flatCommitted || 0, max: r.flatMax })}</p>}
            {(r.occupants || 0) > 0 && (
              <button type="button" onClick={() => onReissue && onReissue(r)} className="btn-ghost mt-2 h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-teal-300 text-[11px] font-semibold">
                <Icon name="file-text" className="w-3 h-3" /> {tr('flatmates.reissueAgreement')}
              </button>
            )}
          </div>
        )}
        {owned && !perRoom && hasSeats && (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name="refresh-cw" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.openSeats')}</span>
            <div className="inline-flex items-center gap-2">
              <button type="button" onClick={() => onSeats && onSeats(r, -1)} disabled={left <= 0} className="seat-close-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaMarkSeatFilled')}><Icon name="minus" className="w-3.5 h-3.5" /></button>
              <span className="text-sm font-bold text-white w-4 text-center" aria-live="polite">{left}</span>
              <button type="button" onClick={() => onSeats && onSeats(r, 1)} disabled={left >= r.seatsTotal} className="seat-reopen-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaReopenSeat')}><Icon name="plus" className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
        {/* Sharing is the tenant's call, not the owner's — so the choice is made
            here, at the point of enquiry, and travels with it. "Find me a
            room-sharer" is what turns an unaffordable room into an affordable one
            for someone with nobody to bring. */}
        {canShare && !owned && !interested && (
          <div className="mb-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">{tr('flatmates.howTakeRoom')}</p>
            <div className="flex flex-wrap gap-1.5">
              {[['solo', 'shareSolo'], ['bring', 'shareBring'], ['match', 'shareMatch']].map(([v, k]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setShare(v)}
                  aria-pressed={share === v}
                  className={'seg text-[11px] font-semibold px-2.5 py-1.5 rounded-lg' + (share === v ? ' active text-white' : ' text-gray-400')}
                >{tr('flatmates.' + k)}</button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2">
          {owned
            ? <span className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-teal-300 text-sm font-semibold cursor-default"><Icon name="megaphone" className="w-4 h-4" /> {tr('flatmates.yourListing')}</span>
            : interested
              ? <button className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-emerald-300 text-sm font-semibold cursor-default" disabled><Icon name="check-check" className="w-4 h-4" /> {tr('flatmates.interestSent')}</button>
              : <button onClick={() => onInterest(r, canShare ? share : 'solo')} className="room-exp-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="hand-heart" className="w-4 h-4" /> {tr('flatmates.messageOwner')}</button>}
          <span className="text-[11px] text-gray-500 flex-shrink-0 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{r.time}</span>
        </div>
      </div>
    </div>
  );
}

export default RoomCard;
