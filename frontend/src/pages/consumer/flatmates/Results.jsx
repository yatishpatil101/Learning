import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { hasInterest as hasInterestDB } from '../../../lib/data/flatmates.js';
import { inr, isVerifiedPost } from './helpers.js';
import { TAB_MOVE_IN } from './model.js';
import { buildFlatmateAlertRecord, flatmateCriteriaChips } from './alertCriteria.js';
import SeekerCard from './SeekerCard.jsx';
import RoomCard from './RoomCard.jsx';
import GroupCard from './GroupCard.jsx';
import Empty from './Empty.jsx';
import FlatmateAlertCard from './FlatmateAlertCard.jsx';

export default function Results({ tab, myPost, openPostModal, markFilled, deleteMyRequest, activeList = [], otherCount = 0, onSwitchTab, saved, onSave, interests, onInterest, onRoomInterest, onReport, onJoin, ownsGroup, onDeleteGroup, onSeatsChange, onRoomSeatsChange, onRoomPeopleChange, onReissueAgreement, ownsRoom, reviews = {}, filtersActive, onClearFilters, onPost, filters, toast, activeFilterCount = 0, raiseHint, onRaiseBudget }) {
  const { t } = useTranslation();
  const isMoveIn = tab === TAB_MOVE_IN;

  // Offer the "create an alert" card as the search tightens: whenever the list is
  // empty, or the seeker has narrowed with 2+ filters (enough intent to want a ping
  // when a match lists). Mirrors the listings page surfacing its alert card.
  const showAlert = activeList.length === 0 || activeFilterCount >= 2;

  // Trust merchandising + smarter empty states: how many results are verified, the
  // active filters spelled out as chips (WHY it's empty), and the live text query.
  const verifiedCount = activeList.reduce((n, x) => n + (isVerifiedPost(x) ? 1 : 0), 0);
  const emptyChips = filtersActive ? flatmateCriteriaChips(buildFlatmateAlertRecord(filters, tab)).slice(1) : [];

  /* Each tab is a MIXED feed by design — "Move in now" carries rooms alongside
     groups that already hold a flat, and "Team up" carries solo seekers alongside
     groups still hunting. So the card choice is a dispatch on the record kind
     rather than something each tab owns. */
  const renderCard = (item, i) => {
    if (item.kind === 'room') {
      return <RoomCard key={'r:' + item.id} anchorId={'r:' + item.id} r={item} i={i} saved={!!saved['r:' + item.id]} onSave={onSave} interested={!!interests['room-' + item.id] || hasInterestDB('room-' + item.id)} onInterest={onRoomInterest} onReport={onReport} myPost={myPost} owned={!!ownsRoom && ownsRoom(item)} onSeats={onRoomSeatsChange} onPeople={onRoomPeopleChange} onReissue={onReissueAgreement} reviewStatus={reviews[item.id]} />;
    }
    if (item.kind === 'group') {
      return <GroupCard key={'g:' + item.id} anchorId={'g:' + item.id} g={item} i={i} saved={!!saved['g:' + item.id]} onSave={onSave} onJoin={onJoin} joined={!!interests['group-' + item.id] || hasInterestDB('group-' + item.id)} onReport={onReport} myPost={myPost} owned={!!ownsGroup && ownsGroup(item)} onDelete={onDeleteGroup} onSeats={onSeatsChange} reviewStatus={reviews[item.id]} />;
    }
    return <SeekerCard key={'s:' + item.id} anchorId={'s:' + item.id} r={item} i={i} saved={!!saved['s:' + item.id]} onSave={onSave} interested={!!interests[item.id] || hasInterestDB(item.id)} onInterest={onInterest} onReport={onReport} myPost={myPost} />;
  };

  return (
    <>
      {/* The user's own live request is a "people" object, so its manage banner
          belongs on the Team up side only. */}
      {myPost && !isMoveIn && (
        <div className="mb-5 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-300 mb-1 flex items-center gap-1.5"><Icon name="megaphone" className="w-3.5 h-3.5" /> {t('flatmates.yourLiveRequest')}</p>
              <p className="text-white font-semibold">{myPost.name} · {inr(myPost.budget)}{t('flatmates.perMonth')} · {(myPost.localities || []).join(', ')}</p>
              {myPost.note && <p className="text-gray-400 text-xs mt-1 line-clamp-2">"{myPost.note}"</p>}
              <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{myPost.time}{myPost.verified ? ' · ' + t('flatmates.verifiedSeeker') : ''}{myPost.verifiedContactOnly ? ' · ' + t('flatmates.verifiedOnlyContact') : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => openPostModal(myPost.id)} className="btn-ghost text-xs font-medium text-gray-200 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="pencil" className="w-3.5 h-3.5" /> {t('flatmates.edit')}</button>
              <button onClick={markFilled} className="btn-ghost text-xs font-medium text-emerald-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="circle-check" className="w-3.5 h-3.5" /> {t('flatmates.markFilled')}</button>
              <button onClick={deleteMyRequest} className="btn-ghost text-xs font-medium text-rose-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="trash-2" className="w-3.5 h-3.5" /> {t('flatmates.delete')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm text-gray-400">
          <span className="text-white font-semibold">{activeList.length}</span>{' '}
          {isMoveIn ? t('flatmates.homesAvailable', { count: activeList.length }) : t('flatmates.peopleLooking', { count: activeList.length })}
          {verifiedCount > 0 && <> · <span className="text-emerald-300 font-semibold">{t('flatmates.nVerified', { count: verifiedCount })}</span></>}
        </p>
      </div>

      {activeList.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{activeList.map(renderCard)}</div>
      ) : (
        <Empty
          icon={isMoveIn ? 'door-open' : 'users-round'}
          title={filtersActive ? (isMoveIn ? t('flatmates.noHomesMatch') : t('flatmates.noFlatmatesMatch')) : (isMoveIn ? t('flatmates.noHomesYet') : t('flatmates.noFlatmatesYet'))}
          text={isMoveIn ? t('flatmates.emptyMoveInText') : t('flatmates.emptyTeamUpText')}
          primary={{ label: t('flatmates.postCta'), icon: 'plus', onClick: onPost }}
          rescue={otherCount > 0 ? {
            count: otherCount,
            text: isMoveIn ? t('flatmates.rescueToTeamUp', { count: otherCount }) : t('flatmates.rescueToMoveIn', { count: otherCount }),
            label: isMoveIn ? t('flatmates.tabTeamUp') : t('flatmates.tabMoveIn'),
            onClick: onSwitchTab,
          } : null}
          filtersActive={filtersActive}
          onClearFilters={onClearFilters}
          chips={emptyChips}
          query={filters.q}
          hint={raiseHint}
          onRaiseBudget={onRaiseBudget}
        />
      )}
      {showAlert && <FlatmateAlertCard filters={filters} tab={tab} toast={toast} />}
    </>
  );
}

