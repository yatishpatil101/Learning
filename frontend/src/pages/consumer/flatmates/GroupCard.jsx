import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { seatsLeft, inr, perHead, shareFloor, moneyRange, groupLocalities, allVerified, matchFor, hostTierMeta, showHostBadge, detailPath, moveInLabel } from './helpers.js';
import { SaveBtn, TileChip, MatchPill, Fresh, ReviewChip, PolicyChip, CardLink } from './atoms.jsx';

export function GroupJoinButton({ g, joined, onJoin }) {
  const { t: tr } = useTranslation();
  const base = 'flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ';
  if (seatsLeft(g) <= 0) return <button className={base + 'btn-ghost opacity-60 cursor-not-allowed text-white'} disabled><Icon name="lock" className="w-4 h-4" /> {tr('flatmates.groupFull')}</button>;
  if (joined) return <button className={base + 'btn-ghost text-emerald-300 cursor-default'} disabled><Icon name="check-check" className="w-4 h-4" /> {g.policy === 'any' ? tr('flatmates.joined') : tr('flatmates.requested')}</button>;
  if (g.policy !== 'any') return <button onClick={() => onJoin(g)} className={base + 'request-btn btn-teal text-white'}><Icon name="user-check" className="w-4 h-4" /> {tr('flatmates.requestToJoin')}</button>;
  return <button onClick={() => onJoin(g)} className={base + 'join-btn btn-teal text-white'}><Icon name="user-plus" className="w-4 h-4" /> {tr('flatmates.joinGroup')}</button>;
}

const groupMatch = (g, myPost) => matchFor({ localities: groupLocalities(g), budget: shareFloor(g) || perHead(g), budgetMax: perHead(g), gender: g.policy === 'women' ? 'female' : g.policy === 'men' ? 'male' : 'any' }, myPost);

export function GroupBadges({ g, reviewStatus, myPost, owned }) {
  const { t: tr } = useTranslation();
  const left = seatsLeft(g);
  const match = groupMatch(g, myPost);
  return (
    <>
      {left <= 0
        ? <span className="chip px-2 py-0.5 rounded-full text-[10px] text-amber-300 whitespace-nowrap">{tr('flatmates.full')}</span>
        : <span className="badge-seeker px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap">{tr('flatmates.seatsLeft', { count: left })}</span>}
      <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="map-pin" className="w-3 h-3" />{groupLocalities(g).join(' · ')}</span>
      {g.hunting && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-sky-300"><Icon name="search" className="w-2.5 h-2.5" /> {tr('flatmates.lookingForFlat')}</span>}
      <PolicyChip policy={g.policy} />
      {allVerified(g) && <span className="badge-seeker px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-white"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('flatmates.allVerified')}</span>}
      {showHostBadge(g, reviewStatus) && <span className={'chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + hostTierMeta(g).cls}><Icon name={hostTierMeta(g).icon} className="w-2.5 h-2.5" /> {hostTierMeta(g).label}</span>}
      {g.ownerConsent && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="badge-check" className="w-2.5 h-2.5" /> {tr('flatmates.ownerConsented')}</span>}
      <ReviewChip status={reviewStatus} kind="group" id={g.id} owned={owned} />
      <MatchPill match={match} />
      <Fresh item={g} />
    </>
  );
}

function GroupCard({ g, i, saved, onSave, anchorId, myPost }) {
  const { t: tr } = useTranslation();
  const href = detailPath('group', g.id);
  const left = seatsLeft(g);
  const match = groupMatch(g, myPost);
  const trust = showHostBadge(g, g.reviewStatus) ? hostTierMeta(g).label : allVerified(g) ? tr('flatmates.allVerified') : null;
  const moveBy = g.hunting && g.preferences?.moveInBy;
  return (
    <div data-sf-id={anchorId} className="sf-card relative rounded-2xl p-4 reveal" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-white leading-snug line-clamp-2">
            {trust && <span className="inline-flex align-[-2px] mr-1 text-teal-400" role="img" aria-label={trust} title={trust}><Icon name="shield-check" className="w-4 h-4" /></span>}
            <Link to={href} data-tap-exempt className="relative z-[1]">{g.title}</Link>
          </h3>
          <p className="flex items-center gap-1 text-xs text-gray-400 mt-1"><Icon name="map-pin" className="w-3 h-3 text-teal-400 shrink-0" /><span className="truncate">{groupLocalities(g).join(', ')}</span></p>
        </div>
        <SaveBtn k={'g:' + g.id} saved={saved} onSave={onSave} className="relative z-[1] shrink-0 -mt-1 -mr-1 bg-white/5 border border-white/10 text-gray-400" />
      </div>
      <p className="sf-price mt-3 text-lg font-extrabold text-white leading-tight">
        {g.hunting ? moneyRange(shareFloor(g), perHead(g), tr) : inr(perHead(g))}<span className="text-sm font-normal text-gray-400">{tr('flatmates.perMonth')}</span>
        <span className="text-[11px] font-normal text-gray-500 ml-1.5">{g.hunting ? tr('flatmates.tagBudgetEach') : tr('flatmates.tagYourShare')}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {left > 0 ? <TileChip icon="users">{tr('flatmates.seatsLeft', { count: left })}</TileChip> : <TileChip icon="lock">{tr('flatmates.full')}</TileChip>}
        {g.hunting && <TileChip icon="search">{tr('flatmates.lookingForFlat')}</TileChip>}
        {moveBy && <TileChip icon="calendar-check">{moveInLabel(moveBy)}</TileChip>}
        {g.policy === 'women' && <TileChip icon="venus">{tr('flatmates.womenOnly')}</TileChip>}
        {g.policy === 'men' && <TileChip icon="mars">{tr('flatmates.menOnly')}</TileChip>}
        {match ? <MatchPill match={match} /> : <Fresh item={g} />}
      </div>
      <CardLink to={href} />
    </div>
  );
}

export default GroupCard;
