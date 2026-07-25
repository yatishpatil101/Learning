import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { inr, genderPref, foodLabel, matchTier, savePayload, seatsLeft, hostTierMeta, showHostBadge, moveInLabel } from './helpers.js';
import { Chip, MatchPill, Fresh } from './atoms.jsx';

function RoomCard({ r, i, saved, onSave, interested, onInterest, onReport, anchorId, myPost, owned, onSeats, reviewStatus }) {
  const { t: tr } = useTranslation();
  const tier = matchTier(r, myPost);
  // Owner tier is earned once Ops verifies the listing docs (r.verified); tenant
  // tier is a self-claim that earns its badge only after Ops approves the uploaded
  // agreement (reviewStatus). The Ops queue state is shown separately below.
  const tierMeta = showHostBadge(r, reviewStatus, !!r.verified) ? hostTierMeta(r) : null;
  const hasSeats = r.seatsOpen != null;
  const left = hasSeats ? seatsLeft(r) : null;
  return (
    <div data-sf-id={anchorId} className="sf-card rounded-2xl overflow-hidden reveal flex flex-col" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="relative h-36">
        <img src={r.img} alt={'Room in ' + r.society} className="w-full h-36 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-3 left-3 flex items-center gap-2">{r.verified && <span className="badge-seeker inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('shareFlat.verified')}</span>}<MatchPill tier={tier} /><Fresh item={r} /></div>
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button onClick={() => onSave('r:' + r.id, savePayload('room', r))} className={'save-btn seg p-2 rounded-lg bg-black/30 backdrop-blur-md text-gray-200' + (saved ? ' saved' : '')} aria-pressed={saved}><Icon name="bookmark" className="w-4 h-4" /></button>
          <button className="report-btn seg p-2 rounded-lg bg-black/30 backdrop-blur-md text-gray-200" aria-label={tr('shareFlat.ariaReportRoom')} onClick={() => onReport && onReport({ id: r.id, title: 'Room in ' + r.society, ownerName: r.society, kind: 'listing' })}><Icon name="flag" className="w-4 h-4" /></button>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <div className="min-w-0"><p className="text-white font-semibold text-sm leading-tight drop-shadow truncate">{r.society}</p><p className="text-[11px] text-gray-200 inline-flex items-center gap-1"><Icon name="map-pin" className="w-3 h-3 text-teal-300" />{r.localities[0]}</p></div>
        </div>
      </div>
      <div className="p-5 flex flex-col flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-3"><Chip>{r.flatType}</Chip><Chip>{r.roomType}</Chip>{r.homeTypeLabel && r.homeTypeLabel !== 'Flat' && <Chip>{r.homeTypeLabel}</Chip>}{r.gatedCommunity && <Chip>{tr('shareFlat.gated')}</Chip>}</div>
        {(tierMeta || reviewStatus || hasSeats) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {tierMeta && <span className={'chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + tierMeta.cls}><Icon name={tierMeta.icon} className="w-2.5 h-2.5" /> {tierMeta.label}</span>}
            {reviewStatus === 'pending' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-amber-300"><Icon name="clock" className="w-2.5 h-2.5" /> {tr('shareFlat.pendingOpsReview')}</span>}
            {reviewStatus === 'approved' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('shareFlat.opsVerified')}</span>}
            {reviewStatus === 'rejected' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-rose-300"><Icon name="shield-alert" className="w-2.5 h-2.5" /> {tr('shareFlat.reviewFailed')}</span>}
            {hasSeats && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-gray-200">{left > 0 ? tr('shareFlat.seatsOpen', { count: left }) : tr('shareFlat.filled')}</span>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.yourShareMo')}</p><p className="text-lg font-bold gradient-text">{inr(r.budget)}</p></div>
          <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.deposit')}</p><p className="text-xs font-medium text-gray-200">{r.deposit ? inr(r.deposit) : '—'}</p></div>
          <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.moveIn')}</p><p className="text-xs font-medium text-gray-200">{moveInLabel(r.moveIn)}</p></div>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">{[genderPref(r.gender), foodLabel(r.food), r.furnishing, r.attachedBath === 'attached' ? tr('shareFlat.attachedBath') : null].filter(Boolean).map((x) => <Chip key={x}>{x}</Chip>)}</div>
        {r.note && <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-3">"{r.note}"</p>}
        <div className="flex flex-wrap gap-1.5 mb-4">{(r.tags || []).slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}</div>
        {owned && hasSeats && (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name="refresh-cw" className="w-3.5 h-3.5 text-teal-300" /> {tr('shareFlat.openSeats')}</span>
            <div className="inline-flex items-center gap-2">
              <button type="button" onClick={() => onSeats && onSeats(r, -1)} disabled={left <= 0} className="seat-close-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('shareFlat.ariaMarkSeatFilled')}><Icon name="minus" className="w-3.5 h-3.5" /></button>
              <span className="text-sm font-bold text-white w-4 text-center" aria-live="polite">{left}</span>
              <button type="button" onClick={() => onSeats && onSeats(r, 1)} disabled={left >= r.seatsTotal} className="seat-reopen-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('shareFlat.ariaReopenSeat')}><Icon name="plus" className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2">
          {owned
            ? <span className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-teal-300 text-sm font-semibold cursor-default"><Icon name="megaphone" className="w-4 h-4" /> {tr('shareFlat.yourListing')}</span>
            : interested
              ? <button className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-emerald-300 text-sm font-semibold cursor-default" disabled><Icon name="check-check" className="w-4 h-4" /> {tr('shareFlat.interestSent')}</button>
              : <button onClick={() => onInterest(r)} className="room-exp-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="hand-heart" className="w-4 h-4" /> {tr('shareFlat.messageOwner')}</button>}
          <span className="text-[11px] text-gray-500 flex-shrink-0 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{r.time}</span>
        </div>
      </div>
    </div>
  );
}

export default RoomCard;
