import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import LoadError from '../../../components/LoadError.jsx';
import Pager from '../../../components/ui/Pager.jsx';
import { isPubliclyVisible } from '../../../lib/data/flatmates.js';
import { inr } from './helpers.js';
import { TAB_MOVE_IN } from './model.js';
import { buildFlatmateAlertRecord, flatmateCriteriaChips } from './alertCriteria.js';
import SeekerCard from './SeekerCard.jsx';
import RoomCard from './RoomCard.jsx';
import GroupCard from './GroupCard.jsx';
import Empty from './Empty.jsx';
import FlatmateAlertCard from './FlatmateAlertCard.jsx';

export default function Results({ tab, myPost, openPostModal, markFilled, deleteMyRequest, activeList = [], total = 0, verifiedTotal = 0, page = 0, pageCount = 0, onGoToPage, loaded = true, searching = false, otherCount = 0, onSwitchTab, saved, onSave, interests, onInterest, onRoomInterest, onReport, onJoin, ownsGroup, onDeleteGroup, onSeatsChange, onRoomSeatsChange, onRoomPeopleChange, onReissueAgreement, ownsRoom, reviews = {}, filtersActive, onClearFilters, onPost, filters, toast, activeFilterCount = 0, raiseHint, onRaiseBudget, feedFailed = false, feedError, onRetryFeeds }) {
  const { t } = useTranslation();
  const isMoveIn = tab === TAB_MOVE_IN;
  /* Only the *empty* case is ambiguous. If anything loaded, the user has real posts to read and
     the app-wide banner already says the connection is unhappy. */
  const showLoadError = feedFailed && activeList.length === 0;

  // Never on a failed read and never before the first answer: "get alerted when one appears" is a
  // claim that there are none, and neither state knows that.
  const showAlert = loaded && !showLoadError && (total === 0 || activeFilterCount >= 2);

  /* Both counts come from the SERVER and describe the whole result set. Counting `activeList`
     would read "24 homes available" on a market of four hundred. */
  const emptyChips = filtersActive ? flatmateCriteriaChips(buildFlatmateAlertRecord(filters, tab)).slice(1) : [];

  /* Each tab is a mixed feed, so the card is a dispatch on record kind. `interested` is a DISPLAY
     hint only — short-circuiting the handler makes the API's `already_interested` 409 unreachable. */
  const renderCard = (item, i) => {
    if (item.kind === 'room') {
      return <RoomCard key={'r:' + item.id} anchorId={'r:' + item.id} r={item} i={i} saved={!!saved['r:' + item.id]} onSave={onSave} interested={!!interests['room-' + item.id]} onInterest={onRoomInterest} onReport={onReport} myPost={myPost} owned={!!ownsRoom && ownsRoom(item)} onSeats={onRoomSeatsChange} onPeople={onRoomPeopleChange} onReissue={onReissueAgreement} reviewStatus={reviews[item.id]} />;
    }
    if (item.kind === 'group') {
      return <GroupCard key={'g:' + item.id} anchorId={'g:' + item.id} g={item} i={i} saved={!!saved['g:' + item.id]} onSave={onSave} onJoin={onJoin} joined={!!interests['group-' + item.id]} onReport={onReport} myPost={myPost} owned={!!ownsGroup && ownsGroup(item)} onDelete={onDeleteGroup} onSeats={onSeatsChange} reviewStatus={reviews[item.id]} />;
    }
    return <SeekerCard key={'s:' + item.id} anchorId={'s:' + item.id} r={item} i={i} saved={!!saved['s:' + item.id]} onSave={onSave} interested={!!interests[item.id]} onInterest={onInterest} onReport={onReport} myPost={myPost} />;
  };

  return (
    <>
      {/* Team-up only: a new post waits for a moderator, and the banner has to say so — otherwise
          a success toast is followed by a board the author cannot find themselves on. */}
      {myPost && !isMoveIn && (() => {
        const inReview = !isPubliclyVisible(myPost);
        return (
        <div className={'mb-5 rounded-2xl border p-4 sm:p-5 ' + (inReview ? 'border-amber-500/30 bg-amber-500/5' : 'border-teal-500/30 bg-teal-500/5')}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className={'text-[11px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5 ' + (inReview ? 'text-amber-300' : 'text-teal-300')}><Icon name={inReview ? 'clock' : 'megaphone'} className="w-3.5 h-3.5" /> {inReview ? t('flatmates.yourRequestInReview') : t('flatmates.yourLiveRequest')}</p>
              <p className="text-white font-semibold">{myPost.name} · {inr(myPost.budget)}{t('flatmates.perMonth')} · {(myPost.localities || []).join(', ')}</p>
              {myPost.note && <p className="text-gray-400 text-xs mt-1 line-clamp-2">"{myPost.note}"</p>}
              {inReview && <p className="text-amber-200/80 text-xs mt-1.5">{t('flatmates.inReviewHint')}</p>}
              <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1"><span className={'w-1.5 h-1.5 rounded-full ' + (inReview ? 'bg-amber-400' : 'bg-emerald-400')} />{myPost.time}{myPost.verified ? ' · ' + t('flatmates.verifiedSeeker') : ''}{myPost.verifiedContactOnly ? ' · ' + t('flatmates.verifiedOnlyContact') : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => openPostModal(myPost.id)} className="btn-ghost text-xs font-medium text-gray-200 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="pencil" className="w-3.5 h-3.5" /> {t('flatmates.edit')}</button>
              <button onClick={markFilled} className="btn-ghost text-xs font-medium text-emerald-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="circle-check" className="w-3.5 h-3.5" /> {t('flatmates.markFilled')}</button>
              <button onClick={deleteMyRequest} className="btn-ghost text-xs font-medium text-rose-300 px-3.5 py-2 rounded-xl inline-flex items-center gap-1.5"><Icon name="trash-2" className="w-3.5 h-3.5" /> {t('flatmates.delete')}</button>
            </div>
          </div>
        </div>
        );
      })()}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        {/* Announced, because paging and filtering replace the whole list without moving focus.
            `polite` so it waits rather than interrupting the control still being operated. */}
        <p className="text-sm text-gray-400" aria-live="polite">
          {showLoadError ? t('flatmates.countUnavailable') : !loaded ? t('flatmates.countLoading') : (
            <>
              <span className="text-white font-semibold">{total}</span>{' '}
              {isMoveIn ? t('flatmates.homesAvailable', { count: total }) : t('flatmates.peopleLooking', { count: total })}
              {verifiedTotal > 0 && <> · <span className="text-emerald-300 font-semibold">{t('flatmates.nVerified', { count: verifiedTotal })}</span></>}
            </>
          )}
        </p>
      </div>

      {showLoadError ? (
        <LoadError message={t('flatmates.loadError')} error={feedError} onRetry={onRetryFeeds} />
      ) : activeList.length ? (
        <>
          <div className={'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5' + (searching ? ' opacity-60 transition-opacity' : '')}>{activeList.filter((item) => item.id !== myPost?.id).map(renderCard)}</div>
          <Pager page={page + 1} pageCount={pageCount} onGoTo={(n) => onGoToPage(n - 1)} />
        </>
      ) : !loaded ? (
        /* Nothing to say yet: the empty state below is an ASSERTION, and "no homes match, clear
           your filters" names a cause for a search the server has not answered. */
        <div className="py-16 text-center text-sm text-gray-500">{t('flatmates.countLoading')}</div>
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

