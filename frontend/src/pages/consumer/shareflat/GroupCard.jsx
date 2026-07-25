import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { seatsLeft, inr, perHead, allVerified, policyAvatar, matchTier, hostTierMeta, showHostBadge, savePayload } from './helpers.js';
import { Chip, SaveBtn, MatchPill, Fresh } from './atoms.jsx';

function GroupCard({ g, i, saved, onSave, onJoin, joined, onReport, anchorId, myPost, owned, onDelete, onSeats, reviewStatus }) {
  const { t: tr } = useTranslation();
  const left = seatsLeft(g), full = left <= 0;
  const tier = matchTier({ localities: [g.locality], budget: perHead(g), gender: g.policy === 'women' ? 'female' : g.policy === 'men' ? 'male' : 'any' }, myPost);
  return (
    <div data-sf-id={anchorId} className="sf-card rounded-2xl p-5 reveal flex flex-col" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-white font-semibold leading-snug min-w-0">{g.title}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {full ? <span className="chip px-2 py-0.5 rounded-full text-[10px] text-amber-300">{tr('shareFlat.full')}</span> : <span className="badge-seeker px-2 py-0.5 rounded-full text-[10px] font-bold text-white">{tr('shareFlat.seatsLeft', { count: left })}</span>}
          <SaveBtn k={'g:' + g.id} saved={saved} onSave={onSave} data={savePayload('group', g)} small />
          <button className="report-btn seg p-1.5 rounded-lg text-gray-400" aria-label={tr('shareFlat.ariaReportGroup')} onClick={() => onReport && onReport({ id: g.id, title: g.title, ownerName: (g.members && g.members[0] && g.members[0].name) || 'Group', kind: 'user' })}><Icon name="flag" className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mb-3">
        <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="map-pin" className="w-3 h-3" />{g.locality}</span>
        <span className="text-gray-600">·</span>
        {g.policy === 'women' ? <span className="chip px-2 py-0.5 rounded-md text-[10px] text-pink-300 inline-flex items-center gap-1"><Icon name="venus" className="w-2.5 h-2.5" /> {tr('shareFlat.womenOnly')}</span> : g.policy === 'men' ? <span className="chip px-2 py-0.5 rounded-md text-[10px] text-blue-300 inline-flex items-center gap-1"><Icon name="mars" className="w-2.5 h-2.5" /> {tr('shareFlat.menOnly')}</span> : <span className="chip px-2 py-0.5 rounded-md text-[10px] text-gray-300">{tr('shareFlat.openToAnyone')}</span>}
        {allVerified(g) && <span className="badge-seeker px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-white"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('shareFlat.allVerified')}</span>}
        {showHostBadge(g, reviewStatus) && <span className={'chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + hostTierMeta(g).cls}><Icon name={hostTierMeta(g).icon} className="w-2.5 h-2.5" /> {hostTierMeta(g).label}</span>}
        {g.ownerConsent && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="badge-check" className="w-2.5 h-2.5" /> {tr('shareFlat.ownerConsented')}</span>}
        {reviewStatus === 'pending' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-amber-300"><Icon name="clock" className="w-2.5 h-2.5" /> {tr('shareFlat.pendingOpsReview')}</span>}
        {reviewStatus === 'approved' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('shareFlat.opsVerified')}</span>}
        {reviewStatus === 'rejected' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-rose-300"><Icon name="shield-alert" className="w-2.5 h-2.5" /> {tr('shareFlat.reviewFailed')}</span>}
        <MatchPill tier={tier} />
        <Fresh item={g} />
      </div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.yourShare')}</p><p className="text-lg font-bold gradient-text">{inr(perHead(g))}<span className="text-gray-500 text-xs font-normal">{tr('shareFlat.perMonth')}</span></p></div>
        <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.wholeFlat')}</p><p className="text-xs font-medium text-gray-200">{inr(g.rent)}{tr('shareFlat.perMonth')} · {tr('shareFlat.nSharingWord', { count: g.seatsTotal })}</p></div>
      </div>
      {g.note && <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-2">"{g.note}"</p>}
      <div className="flex flex-wrap gap-1.5 mb-3">{(g.tags || []).slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}</div>
      <div className="flex items-center gap-1 mb-4">
        {g.members.slice(0, 4).map((mm, k) => (
          <div key={k} className={'relative ' + (k > 0 ? '-ml-2' : '')}>
            <div className={'w-9 h-9 rounded-full bg-gradient-to-br ' + policyAvatar(g.policy) + ' flex items-center justify-center text-white text-[11px] font-bold ring-2 ring-[#0f0d1a]'}>{mm.initials}</div>
            {mm.verified && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-[#0f0d1a] flex items-center justify-center"><Icon name="check" className="w-2 h-2 text-white" /></span>}
          </div>
        ))}
        {Array.from({ length: left }).map((_, k) => <div key={'s' + k} className={'w-9 h-9 rounded-full border border-dashed border-white/25 flex items-center justify-center text-gray-500' + (g.members.length + k > 0 ? ' -ml-2' : '')}><Icon name="plus" className="w-3.5 h-3.5" /></div>)}
      </div>
      {owned && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name="refresh-cw" className="w-3.5 h-3.5 text-teal-300" /> {tr('shareFlat.openSeats')}</span>
          <div className="inline-flex items-center gap-2">
            <button type="button" onClick={() => onSeats && onSeats(g, -1)} disabled={left <= 0} className="seat-close-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('shareFlat.ariaMarkSeatFilled')}><Icon name="minus" className="w-3.5 h-3.5" /></button>
            <span className="text-sm font-bold text-white w-4 text-center" aria-live="polite">{left}</span>
            <button type="button" onClick={() => onSeats && onSeats(g, 1)} disabled={left >= g.seatsTotal} className="seat-reopen-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('shareFlat.ariaReopenSeat')}><Icon name="plus" className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        {owned
          ? <>
              <span className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-teal-300 text-sm font-semibold cursor-default"><Icon name="megaphone" className="w-4 h-4" /> {tr('shareFlat.yourGroup')}</span>
              <button onClick={() => onDelete && onDelete(g)} className="delete-group-btn btn-ghost inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-rose-300 text-sm font-semibold" aria-label={tr('shareFlat.ariaDeleteGroup')}><Icon name="trash-2" className="w-4 h-4" /> {tr('shareFlat.delete')}</button>
            </>
          : full ? <button className="btn-ghost opacity-60 cursor-not-allowed flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold" disabled><Icon name="lock" className="w-4 h-4" /> {tr('shareFlat.groupFull')}</button>
            : joined ? <button className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-emerald-300 text-sm font-semibold cursor-default" disabled><Icon name="check-check" className="w-4 h-4" /> {g.policy === 'any' ? tr('shareFlat.joined') : tr('shareFlat.requested')}</button>
              : g.policy !== 'any' ? <button onClick={() => onJoin(g)} className="request-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="user-check" className="w-4 h-4" /> {tr('shareFlat.requestToJoin')}</button>
                : <button onClick={() => onJoin(g)} className="join-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="user-plus" className="w-4 h-4" /> {tr('shareFlat.joinGroup')}</button>}
        <span className="text-[11px] text-gray-500 flex-shrink-0 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{g.time}</span>
      </div>
    </div>
  );
}

export default GroupCard;
