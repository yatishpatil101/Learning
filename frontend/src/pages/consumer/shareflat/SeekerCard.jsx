import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { avatarGrad, initials, genderLabel, inr, matchTier, savePayload, moveInLabel } from './helpers.js';
import { FLAT_PREF_LBL, ROOM_PREF_LBL } from './constants.js';
import { Chip, SaveBtn, MatchPill, Fresh } from './atoms.jsx';

function SeekerCard({ r, i, saved, onSave, interested, onInterest, verifiedContactOnly, onReport, anchorId, myPost }) {
  const { t: tr } = useTranslation();
  const tier = matchTier(r, myPost);
  return (
    <div data-sf-id={anchorId} className="sf-card rounded-2xl p-5 reveal flex flex-col" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="flex items-start gap-3 mb-3">
        <div className={'w-12 h-12 rounded-full bg-gradient-to-br ' + avatarGrad(r.gender) + ' flex items-center justify-center text-white font-bold flex-shrink-0'}>{initials(r.name)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-white font-semibold truncate">{r.name}</h3>
            {r.verified && <span className="badge-seeker inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('shareFlat.verifiedSeeker')}</span>}
            <MatchPill tier={tier} />
            <Fresh item={r} />
          </div>
          <p className="text-gray-400 text-xs mt-0.5 truncate">{genderLabel(r.gender)}{r.age ? ' · ' + r.age : ''}{r.occupation ? ' · ' + r.occupation : ''}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <SaveBtn k={'s:' + r.id} saved={saved} onSave={onSave} data={savePayload('flatmate', r)} />
          <button className="report-btn seg p-2 rounded-lg text-gray-400" aria-label={tr('shareFlat.ariaReportPost')} onClick={() => onReport && onReport({ id: r.id, title: 'Flatmate: ' + r.name, ownerName: r.name, ownerMobile: r.mobile, kind: 'user' })}><Icon name="flag" className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.budgetMonth')}</p><p className="text-lg font-bold gradient-text">{inr(r.budget)}</p></div>
        <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('shareFlat.moveIn')}</p><p className="text-xs font-medium text-gray-200">{moveInLabel(r.moveIn)}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
        {(r.localities || []).map((l, k) => <span key={l} className="inline-flex items-center gap-1 text-[11px] text-teal-300">{k > 0 && <span className="text-gray-600">·</span>}<Icon name="map-pin" className="w-3 h-3" />{l}</span>)}
      </div>
      {(r.roomPref && r.roomPref !== 'any') || (r.flatPref && r.flatPref !== 'any') ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {r.roomPref && r.roomPref !== 'any' && <span className="inline-flex items-center gap-1 text-[11px] text-gray-300"><Icon name="door-open" className="w-3 h-3 text-teal-300" />{ROOM_PREF_LBL[r.roomPref]}</span>}
          {r.flatPref && r.flatPref !== 'any' && <span className="inline-flex items-center gap-1 text-[11px] text-gray-300"><Icon name="users-round" className="w-3 h-3 text-teal-300" />{FLAT_PREF_LBL[r.flatPref]}</span>}
        </div>
      ) : null}
      {r.note && <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-3">"{r.note}"</p>}
      <div className="flex flex-wrap gap-1.5 mb-4">{(r.tags || []).slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}</div>
      <div className="mt-auto flex items-center gap-2">
        {interested
          ? <button className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-emerald-300 text-sm font-semibold cursor-default" disabled><Icon name="check-check" className="w-4 h-4" /> {tr('shareFlat.interested')}</button>
          : <button onClick={() => onInterest(r)} className="exp-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="hand-heart" className="w-4 h-4" /> {tr('shareFlat.expressInterest')}</button>}
        <span className="text-[11px] text-gray-500 flex-shrink-0 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{r.time}</span>
      </div>
      {r.verifiedContactOnly && <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-amber-300" title={tr('shareFlat.titleVerifiedOnly')}><Icon name="shield" className="w-2.5 h-2.5" /> {tr('shareFlat.acceptsVerifiedOnly')}</div>}
    </div>
  );
}

export default SeekerCard;
