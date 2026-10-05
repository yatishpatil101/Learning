import { useTranslation } from 'react-i18next';
import LoadError from '../../../components/LoadError.jsx';
import Pager from '../../../components/ui/Pager.jsx';
import Select from '../../../components/ui/Select.jsx';
import { isPubliclyVisible } from '../../../lib/data/flatmates.js';
import { seekerBudget, detailPath, seekerTitle, roomTitle, inr, perHead, groupLocalities } from './helpers.js';
import MyPostsStrip from '../../../components/MyPostsStrip.jsx';
import { TAB_MOVE_IN, hasAddress, bestPerPersonRent } from './model.js';
import { buildFlatmateAlertRecord, flatmateCriteriaChips } from './alertCriteria.js';
import SeekerCard from './SeekerCard.jsx';
import RoomCard from './RoomCard.jsx';
import GroupCard from './GroupCard.jsx';
import Empty from './Empty.jsx';
import FlatmateAlertCard from './FlatmateAlertCard.jsx';
import { flatmateSortOptions } from './FilterBar.jsx';

export default function Results({ tab, myPost, myRooms = [], myGroups = [], activeList = [], total = 0, verifiedTotal = 0, page = 0, pageCount = 0, onGoToPage, loaded = true, searching = false, otherCount = 0, onSwitchTab, saved, onSave, ownsGroup, ownsRoom, filtersActive, onClearFilters, onPost, filters, toast, activeFilterCount = 0, raiseHint, onRaiseBudget, feedFailed = false, feedError, onRetryFeeds, sortMode, onSort }) {
  const { t } = useTranslation();
  const isMoveIn = tab === TAB_MOVE_IN;
  const showLoadError = feedFailed && activeList.length === 0;

  // Never on a failed read and never before the first answer: "get alerted when one appears" is a
  // claim that there are none, and neither state knows that.
  const showAlert = loaded && !showLoadError && (total === 0 || activeFilterCount >= 2);

  /* Both counts come from the SERVER and describe the whole result set. */
  const emptyChips = filtersActive ? flatmateCriteriaChips(buildFlatmateAlertRecord(filters, tab)).slice(1) : [];

  const renderCard = (item, i) => {
    if (item.kind === 'room') {
      return <RoomCard key={'r:' + item.id} anchorId={'r:' + item.id} r={item} i={i} saved={!!saved['r:' + item.id]} onSave={onSave} myPost={myPost} />;
    }
    if (item.kind === 'group') {
      return <GroupCard key={'g:' + item.id} anchorId={'g:' + item.id} g={item} i={i} saved={!!saved['g:' + item.id]} onSave={onSave} myPost={myPost} />;
    }
    return <SeekerCard key={'s:' + item.id} anchorId={'s:' + item.id} r={item} i={i} saved={!!saved['s:' + item.id]} onSave={onSave} myPost={myPost} />;
  };
  const isMine = (item) => (item.kind === 'room' ? ownsRoom?.(item) : item.kind === 'group' ? ownsGroup?.(item) : item.id === myPost?.id);

  const status = (item) => t(isPubliclyVisible(item) ? 'common.myPostsLive' : item.modStatus === 'pending' ? 'common.myPostsInReview' : item.modStatus === 'expired' ? 'common.myPostsExpired' : 'flatmates.detailNotPublic');
  const mine = [
    ...(!isMoveIn && myPost ? [{ id: 's:' + myPost.id, to: detailPath('post', myPost.id), pending: !isPubliclyVisible(myPost), label: isPubliclyVisible(myPost) ? t('flatmates.yourLiveRequest') : myPost.modStatus === 'expired' ? t('flatmates.yourRequestExpired') : t('flatmates.yourRequestInReview'), title: seekerTitle(myPost), sub: [seekerBudget(myPost) + t('flatmates.perMonth'), (myPost.localities || []).join(', ')].join(' · ') }] : []),
    ...(isMoveIn ? myRooms.filter((r) => r.status !== 'archived').map((r) => ({ id: 'r:' + r.id, to: detailPath('room', r.id), pending: !isPubliclyVisible(r), label: t('flatmates.yourListing') + ' · ' + status(r), title: roomTitle(r), sub: [inr(bestPerPersonRent(r)) + t('flatmates.perMonth'), r.localities?.[0] || r.locality].filter(Boolean).join(' · ') })) : []),
    ...myGroups.filter((g) => hasAddress(g) === isMoveIn).map((g) => ({ id: 'g:' + g.id, to: detailPath('group', g.id), pending: !isPubliclyVisible(g), label: t('flatmates.yourGroup') + ' · ' + status(g), title: g.title, sub: [inr(perHead(g)) + t('flatmates.perMonth'), groupLocalities(g).join(', ')].filter(Boolean).join(' · ') })),
  ];

  return (
    <>

      <MyPostsStrip items={mine} viewAllHref="/dashboard#listings" />

      <div className="flex items-center justify-between mb-4 gap-3">

        <p className="text-sm text-gray-400 min-w-0" aria-live="polite">
          {showLoadError ? t('flatmates.countUnavailable') : !loaded ? t('flatmates.countLoading') : (
            <>
              <span className="text-white font-semibold">{total}</span>{' '}
              {isMoveIn ? t('flatmates.homesAvailable', { count: total }) : t('flatmates.peopleLooking', { count: total })}
              {verifiedTotal > 0 && <> · <span className="text-emerald-300 font-semibold">{t('flatmates.nVerified', { count: verifiedTotal })}</span></>}
            </>
          )}
        </p>

        {onSort && <div className="lg:hidden flex shrink-0"><Select value={sortMode} onChange={onSort} options={flatmateSortOptions(t)} className="dz-dd-sort" ariaLabel={t('flatmates.ariaSortPosts')} /></div>}
      </div>

      {showLoadError ? (
        <LoadError message={t('flatmates.loadError')} error={feedError} onRetry={onRetryFeeds} />
      ) : activeList.length ? (
        <>
          <div className={'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5' + (searching ? ' opacity-60 transition-opacity' : '')}>{activeList.filter((item) => !isMine(item)).map(renderCard)}</div>
          <Pager page={page + 1} pageCount={pageCount} onGoTo={(n) => onGoToPage(n - 1)} />
        </>
      ) : !loaded ? (
        /* Nothing to say yet: the empty state below is an ASSERTION, and "no homes match, clear
         * your filters" names a cause for a search the server has not answered. */
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
