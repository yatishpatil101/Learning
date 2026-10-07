import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { avatarGrad, initials, genderLabel, seekerBudget, matchFor, moveInLabel, detailPath, seekerTitle } from './helpers.js';
import { SaveBtn, TileChip, MatchPill, Fresh, CardLink } from './atoms.jsx';

export function SeekerAskButton({ r, owned, interested, onInterest }) {
  const { t: tr } = useTranslation();
  const base = 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ';
  if (owned) return <span className={base + 'btn-ghost text-teal-300 cursor-default'}><Icon name="megaphone" className="w-4 h-4" /> {tr('flatmates.detailYourPost')}</span>;
  if (interested) return <button className={base + 'btn-ghost text-emerald-300 cursor-default'} disabled><Icon name="check-check" className="w-4 h-4" /> {tr('flatmates.interested')}</button>;
  return <button onClick={() => onInterest(r)} className={base + 'exp-btn btn-teal text-white'}><Icon name="hand-heart" className="w-4 h-4" /> {tr('flatmates.expressInterest')}</button>;
}

export const seekerSubtitle = (r) => [genderLabel(r.gender), r.age, r.occupation].filter(Boolean).join(' · ');

function SeekerCard({ r, i, saved, onSave, anchorId, myPost }) {
  const { t: tr } = useTranslation();
  const match = matchFor(r, myPost);
  const href = detailPath('post', r.id);
  const localities = (r.localities || []).join(', ');
  return (
    <div data-sf-id={anchorId} className="sf-card relative rounded-2xl p-4 reveal" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="flex items-start gap-3">
        <div className={'relative w-10 h-10 rounded-full bg-gradient-to-br ' + avatarGrad(r.gender) + ' flex items-center justify-center text-white text-sm font-bold shrink-0'}>
          {initials(r.name)}
          {r.verified && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-teal-500 text-white inline-flex items-center justify-center" role="img" aria-label={tr('flatmates.verifiedSeeker')} title={tr('flatmates.verifiedSeeker')}><Icon name="shield-check" className="w-2.5 h-2.5" /></span>}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold text-white leading-snug line-clamp-2"><Link to={href} data-tap-exempt className="relative z-[1]">{seekerTitle(r)}</Link></h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{[r.title && r.name, seekerSubtitle(r)].filter(Boolean).join(' · ')}</p>
        </div>
        <SaveBtn k={'s:' + r.id} saved={saved} onSave={onSave} className="relative z-[1] shrink-0 -mt-1 -mr-1 text-gray-400" />
      </div>
      <p className="sf-price mt-3 text-lg font-extrabold text-white leading-tight">
        {seekerBudget(r)}<span className="text-sm font-normal text-gray-400">{tr('flatmates.perMonth')}</span>
        <span className="text-[11px] font-normal text-gray-500 ml-1.5">{tr('flatmates.tagBudget')}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {localities && <TileChip icon="map-pin">{localities}</TileChip>}
        {r.moveIn && <TileChip icon="calendar-check">{moveInLabel(r.moveIn)}</TileChip>}
        {match ? <MatchPill match={match} /> : <Fresh item={r} />}
      </div>
      <CardLink to={href} />
    </div>
  );
}

export default SeekerCard;
