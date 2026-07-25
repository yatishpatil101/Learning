import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { hasInterest as hasInterestDB } from '../../../lib/data/shareFlat.js';
import { inr, isVerifiedPost } from './helpers.js';
import { buildShareAlertRecord, shareCriteriaChips } from './alertCriteria.js';
import SeekerCard from './SeekerCard.jsx';
import RoomCard from './RoomCard.jsx';
import GroupCard from './GroupCard.jsx';
import Empty from './Empty.jsx';
import ShareAlertCard from './ShareAlertCard.jsx';

export default function Results({ tab, myPost, openPostModal, markFilled, deleteMyRequest, seekerList, roomList, groupList, saved, onSave, interests, onInterest, onRoomInterest, onReport, onJoin, ownsGroup, onDeleteGroup, onSeatsChange, onRoomSeatsChange, ownsRoom, reviews = {}, seg, filtersActive, onClearFilters, onListRoom, onCreateGroup, filters, toast, activeFilterCount = 0, raiseHint, onRaiseBudget }) {
  const { t } = useTranslation();

  // Offer the "create an alert" card as the search tightens: whenever the list is
  // empty, or the seeker has narrowed with 2+ filters (enough intent to want a ping
  // when a match lists). Mirrors the listings page surfacing its alert card.
  const showAlert = (len) => len === 0 || activeFilterCount >= 2;

  // Trust merchandising + smarter empty states: how many results are verified, the
  // active filters spelled out as chips (WHY it's empty), and the live text query.
  const verifiedCount = (list) => list.reduce((n, x) => n + (isVerifiedPost(x) ? 1 : 0), 0);
  const emptyChips = filtersActive ? shareCriteriaChips(buildShareAlertRecord(filters, tab)).slice(1) : [];
  const verifiedNote = (n) => (n > 0 ? <> · <span className="text-emerald-300 font-semibold">{t('shareFlat.nVerified', { count: n })}</span></> : null);

  if (tab === 'flatmates') {
    return (
      <>
        {myPost && (
          <div className="mb-5 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-300 mb-1 flex items-center gap-1.5"><Icon name="megaphone" className="w-3.5 h-3.5" /> {t('shareFlat.yourLiveRequest')}</p>
                <p className="text-white font-semibold">{myPost.name} · {inr(myPost.budget)}{t('shareFlat.perMonth')} · {(myPost.localities || []).join(', ')}</p>
                {myPost.note && <p className="text-gray-400 text-xs mt-1 line-clamp-2">"{myPost.note}"</p>}
                <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{myPost.time}{myPost.verified ? ' · ' + t('shareFlat.verifiedSeeker') : ''}{myPost.verifiedContactOnly ? ' · ' + t('shareFlat.verifiedOnlyContact') : ''}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => openPostModal(myPost.id)} className="btn-ghost text-xs font-medium text-gray-200 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="pencil" className="w-3.5 h-3.5" /> {t('shareFlat.edit')}</button>
                <button onClick={markFilled} className="btn-ghost text-xs font-medium text-emerald-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="circle-check" className="w-3.5 h-3.5" /> {t('shareFlat.markFilled')}</button>
                <button onClick={deleteMyRequest} className="btn-ghost text-xs font-medium text-rose-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="trash-2" className="w-3.5 h-3.5" /> {t('shareFlat.delete')}</button>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <p className="text-sm text-gray-400"><span className="text-white font-semibold">{seekerList.length}</span> {t('shareFlat.peopleLooking', { count: seekerList.length })}{verifiedNote(verifiedCount(seekerList))}</p>
        </div>
        {seekerList.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{seekerList.map((r, i) => <SeekerCard key={r.id} anchorId={'s:' + r.id} r={r} i={i} saved={!!saved['s:' + r.id]} onSave={onSave} interested={!!interests[r.id] || hasInterestDB(r.id)} onInterest={onInterest} onReport={onReport} myPost={myPost} />)}</div>
        ) : (
          <Empty
            icon="users-round"
            title={filtersActive ? t('shareFlat.noFlatmatesMatch') : t('shareFlat.noFlatmatesYet')}
            text={t('shareFlat.emptyFlatmatesText')}
            primary={{ label: myPost ? t('shareFlat.editYourRequest') : t('shareFlat.postYourRequest'), icon: 'megaphone', onClick: () => openPostModal(myPost ? myPost.id : null) }}
            filtersActive={filtersActive}
            onClearFilters={onClearFilters}
            chips={emptyChips}
            query={filters.q}
            hint={raiseHint}
            onRaiseBudget={onRaiseBudget}
          />
        )}
        {showAlert(seekerList.length) && <ShareAlertCard filters={filters} tab={tab} toast={toast} />}
      </>
    );
  }

  if (tab === 'rooms') {
    return (
      <>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap"><p className="text-sm text-gray-400"><span className="text-white font-semibold">{roomList.length}</span> {t('shareFlat.roomsAvailableInFlats', { count: roomList.length })}{verifiedNote(verifiedCount(roomList))}</p></div>
        {roomList.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{roomList.map((r, i) => <RoomCard key={r.id} anchorId={'r:' + r.id} r={r} i={i} saved={!!saved['r:' + r.id]} onSave={onSave} interested={!!interests['room-' + r.id] || hasInterestDB('room-' + r.id)} onInterest={onRoomInterest} onReport={onReport} myPost={myPost} owned={!!ownsRoom && ownsRoom(r)} onSeats={onRoomSeatsChange} reviewStatus={reviews[r.id]} />)}</div>
        ) : (
          <Empty
            icon="door-open"
            title={filtersActive ? t('shareFlat.noRoomsMatch') : t('shareFlat.noRoomsYet')}
            text={t('shareFlat.emptyRoomsText')}
            primary={{ label: t('shareFlat.listYourRoom'), icon: 'plus', onClick: onListRoom }}
            filtersActive={filtersActive}
            onClearFilters={onClearFilters}
            chips={emptyChips}
            query={filters.q}
            hint={raiseHint}
            onRaiseBudget={onRaiseBudget}
          />
        )}
        {showAlert(roomList.length) && <ShareAlertCard filters={filters} tab={tab} toast={toast} />}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap"><p className="text-sm text-gray-400"><span className="text-white font-semibold">{groupList.length}</span> {t('shareFlat.openGroupsLooking', { count: groupList.length })}{verifiedNote(verifiedCount(groupList))}</p></div>
      {groupList.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{groupList.map((g, i) => <GroupCard key={g.id} anchorId={'g:' + g.id} g={g} i={i} saved={!!saved['g:' + g.id]} onSave={onSave} onJoin={onJoin} joined={!!interests['group-' + g.id] || hasInterestDB('group-' + g.id)} onReport={onReport} myPost={myPost} owned={!!ownsGroup && ownsGroup(g)} onDelete={onDeleteGroup} onSeats={onSeatsChange} reviewStatus={reviews[g.id]} />)}</div>
      ) : (
        <Empty
          icon="users-round"
          title={filtersActive ? t('shareFlat.noGroupsMatch') : t('shareFlat.noOpenGroupsYet')}
          text={t('shareFlat.emptyGroupsText')}
          primary={{ label: t('shareFlat.createGroup'), icon: 'plus', onClick: onCreateGroup }}
          filtersActive={filtersActive}
          onClearFilters={onClearFilters}
          chips={emptyChips}
          query={filters.q}
          hint={raiseHint}
          onRaiseBudget={onRaiseBudget}
        />
      )}
      {showAlert(groupList.length) && <ShareAlertCard filters={filters} tab={tab} toast={toast} />}
    </>
  );
}
