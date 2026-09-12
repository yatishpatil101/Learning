import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { seatsLeft, inr, perHead, allVerified, policyAvatar, matchTier, hostTierMeta, showHostBadge } from './helpers.js';
import { Chip, SaveBtn, MatchPill, Fresh } from './atoms.jsx';

function GroupCard({ g, i, saved, onSave, onJoin, joined, onReport, anchorId, myPost, owned, onDelete, onSeats, reviewStatus }) {
  const { t: tr } = useTranslation();
  const left = seatsLeft(g), full = left <= 0;
  const tier = matchTier({ localities: [g.locality], budget: perHead(g), gender: g.policy === 'women' ? 'female' : g.policy === 'men' ? 'male' : 'any' }, myPost);
  /* Seats is a status badge, not a control — so it belongs with the other status
     badges rather than in the header competing with the title and the two icon
     buttons. Three items in that header left the title ~160px on a phone and
     wrapped it to three lines.

     SeekerCard already solves this and is the reference here: its header carries
     the identity plus exactly two icon buttons, and every badge flows in the
     content row below. GroupCard now matches.

     Deliberately ONE node rather than a `hidden sm:inline-flex` / `sm:hidden`
     pair in both positions: `getByText` matches the DOM, not what is painted, so
     a duplicate resolves to two elements and breaks every strict-mode locator
     that reads this badge (flatmates-backfill.spec.js does, five times). */
  const seatsBadge = full
    ? <span className="chip px-2 py-0.5 rounded-full text-[10px] text-amber-300 whitespace-nowrap">{tr('flatmates.full')}</span>
    : <span className="badge-seeker px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap">{tr('flatmates.seatsLeft', { count: left })}</span>;
  return (
    <div data-sf-id={anchorId} className="sf-card rounded-2xl p-5 reveal flex flex-col" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-white font-semibold leading-snug min-w-0 flex-1">{g.title}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Sized to match SeekerCard's header buttons — with the badge gone there
              is room, and these were the one cramped 14px pair in the results list. */}
          <SaveBtn k={'g:' + g.id} saved={saved} onSave={onSave} />
          <button className="report-btn seg p-2 rounded-lg text-gray-400" aria-label={tr('flatmates.ariaReportGroup')} onClick={() => onReport && onReport({ id: g.id, title: g.title, ownerName: (g.members && g.members[0] && g.members[0].name) || 'Group', kind: 'share' })}><Icon name="flag" className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mb-3">
        {seatsBadge}
        <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="map-pin" className="w-3 h-3" />{g.locality}</span>
        {g.policy === 'women' ? <span className="chip px-2 py-0.5 rounded-md text-[10px] text-pink-300 inline-flex items-center gap-1"><Icon name="venus" className="w-2.5 h-2.5" /> {tr('flatmates.womenOnly')}</span> : g.policy === 'men' ? <span className="chip px-2 py-0.5 rounded-md text-[10px] text-blue-300 inline-flex items-center gap-1"><Icon name="mars" className="w-2.5 h-2.5" /> {tr('flatmates.menOnly')}</span> : <span className="chip px-2 py-0.5 rounded-md text-[10px] text-gray-300">{tr('flatmates.openToAnyone')}</span>}
        {allVerified(g) && <span className="badge-seeker px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-white"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('flatmates.allVerified')}</span>}
        {showHostBadge(g, reviewStatus) && <span className={'chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + hostTierMeta(g).cls}><Icon name={hostTierMeta(g).icon} className="w-2.5 h-2.5" /> {hostTierMeta(g).label}</span>}
        {g.ownerConsent && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="badge-check" className="w-2.5 h-2.5" /> {tr('flatmates.ownerConsented')}</span>}
        {reviewStatus === 'pending' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-amber-300"><Icon name="clock" className="w-2.5 h-2.5" /> {tr('flatmates.pendingOpsReview')}</span>}
        {reviewStatus === 'approved' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-emerald-300"><Icon name="shield-check" className="w-2.5 h-2.5" /> {tr('flatmates.opsVerified')}</span>}
        {reviewStatus === 'rejected' && <span className="chip px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 text-rose-300"><Icon name="shield-alert" className="w-2.5 h-2.5" /> {tr('flatmates.reviewFailed')}</span>}
        <MatchPill tier={tier} />
        <Fresh item={g} />
      </div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('flatmates.yourShare')}</p><p className="text-lg font-bold gradient-text">{inr(perHead(g))}<span className="text-gray-500 text-xs font-normal">{tr('flatmates.perMonth')}</span></p></div>
        <div className="text-right"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{tr('flatmates.wholeFlat')}</p><p className="text-xs font-medium text-gray-200">{inr(g.rent)}{tr('flatmates.perMonth')} · {tr('flatmates.nSharingWord', { count: g.seatsTotal })}</p></div>
      </div>
      {g.note && <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-2">"{g.note}"</p>}
      <div className="flex flex-wrap gap-1.5 mb-3">{(g.tags || []).slice(0, 4).map((t) => <Chip key={t}>{t}</Chip>)}</div>
      <div className="flex items-center gap-1 mb-4">
        {g.members.slice(0, 4).map((mm, k) => (
          <div key={k} className={'relative ' + (k > 0 ? '-ml-2' : '')}>
            {/* A member who joined via OTP may have no name yet, so there are no initials to draw
                (D118). The server used to store the literal "Member" to keep its NOT NULL happy and
                this circle then showed "M" — a letter of a name nobody has. The fallback belongs
                here instead, where it is plainly a placeholder: a neutral person glyph claims
                nothing about who they are, and it turns back into real initials by itself the
                moment they fill in their profile. */}
            <div className={'w-9 h-9 rounded-full bg-gradient-to-br ' + policyAvatar(g.policy) + ' flex items-center justify-center text-white text-[11px] font-bold ring-2 ring-[#0f0d1a]'}>{mm.initials ? mm.initials : <Icon name="user" className="w-4 h-4 opacity-80" />}</div>
            {mm.verified && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-[#0f0d1a] flex items-center justify-center"><Icon name="check" className="w-2 h-2 text-white" /></span>}
          </div>
        ))}
        {Array.from({ length: left }).map((_, k) => <div key={'s' + k} className={'w-9 h-9 rounded-full border border-dashed border-white/25 flex items-center justify-center text-gray-500' + (g.members.length + k > 0 ? ' -ml-2' : '')}><Icon name="plus" className="w-3.5 h-3.5" /></div>)}
      </div>
      {owned && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name="refresh-cw" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.openSeats')}</span>
          <div className="inline-flex items-center gap-2">
            <button type="button" onClick={() => onSeats && onSeats(g, -1)} disabled={left <= 0} className="seat-close-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaMarkSeatFilled')}><Icon name="minus" className="w-3.5 h-3.5" /></button>
            <span className="text-sm font-bold text-white w-4 text-center" aria-live="polite">{left}</span>
            <button type="button" onClick={() => onSeats && onSeats(g, 1)} disabled={left >= g.seatsTotal} className="seat-reopen-btn seg w-7 h-7 rounded-lg text-gray-300 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" aria-label={tr('flatmates.ariaReopenSeat')}><Icon name="plus" className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        {owned
          ? <>
              <span className="btn-ghost flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-teal-300 text-sm font-semibold cursor-default"><Icon name="megaphone" className="w-4 h-4 shrink-0" /> <span className="truncate">{tr('flatmates.yourGroup')}</span></span>
              {/* Icon-only on a phone: this row carries three items when you own the
                  group (status + delete + timestamp), which is one more than any
                  other card in the list and overflows a 360px tile. The aria-label
                  already names it, so dropping the visible word costs nothing. */}
              <button onClick={() => onDelete && onDelete(g)} className="delete-group-btn btn-ghost inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2.5 rounded-xl text-rose-300 text-sm font-semibold shrink-0" aria-label={tr('flatmates.ariaDeleteGroup')}><Icon name="trash-2" className="w-4 h-4" /> <span className="hidden sm:inline">{tr('flatmates.delete')}</span></button>
            </>
          : full ? <button className="btn-ghost opacity-60 cursor-not-allowed flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold" disabled><Icon name="lock" className="w-4 h-4" /> {tr('flatmates.groupFull')}</button>
            : joined ? <button className="btn-ghost flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-emerald-300 text-sm font-semibold cursor-default" disabled><Icon name="check-check" className="w-4 h-4" /> {g.policy === 'any' ? tr('flatmates.joined') : tr('flatmates.requested')}</button>
              : g.policy !== 'any' ? <button onClick={() => onJoin(g)} className="request-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="user-check" className="w-4 h-4" /> {tr('flatmates.requestToJoin')}</button>
                : <button onClick={() => onJoin(g)} className="join-btn btn-teal flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="user-plus" className="w-4 h-4" /> {tr('flatmates.joinGroup')}</button>}
        <span className="text-[11px] text-gray-500 flex-shrink-0 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{g.time}</span>
      </div>
    </div>
  );
}

export default GroupCard;
