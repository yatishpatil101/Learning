import { lazy, Suspense } from 'react';
import Icon from '../../components/Icon.jsx';
import Hero from './flatmates/Hero.jsx';
import '../../styles/routes/flatmates.css';
import FilterBar from './flatmates/FilterBar.jsx';
import FlatmateMapGate from './flatmates/FlatmateMapGate.jsx';
import Results from './flatmates/Results.jsx';
import PostModal from './flatmates/PostModal.jsx';
import PostChooser from './flatmates/PostChooser.jsx';
import GroupModal from './flatmates/GroupModal.jsx';
import AadhaarVerifyModal from '../../components/auth/AadhaarVerifyModal.jsx';
import OwnerConsentModal from '../../components/auth/OwnerConsentModal.jsx';
import Empty from './flatmates/Empty.jsx';
import ReportModal from '../../components/ReportModal.jsx';
import { SHARE_REPORT_REASONS } from '../../lib/reportReasons.js';
import { useFlatmates, emptyFilters, MAP_MAX_AREAS } from './flatmates/useFlatmates.jsx';
const FlatmateMap = lazy(() => import('./flatmates/FlatmateMap.jsx'));

export default function Flatmates() {
  const {
    rootRef, t, openPostModal, user, isVerified, openVerify,
    filters, setF, viewMode, setViewMode, seg, budgetLbl,
    smartSearchFlat, setFilters, tab, sortMode, onSort, clearFilters,
    flatmateTabs, mapGated, gateAreas, mapAreas, toggleMapArea, kindWord,
    filtersActive, mapItems, setMapAreas, onInterest, onRoomInterest, onJoin,
    onSave, saved, interestedFor, goToPosting, myPost, markFilled,
    deleteMyRequest, activeList, otherCount, switchTab, interests, onReport,
    ownsGroup, deleteGroup, setGroupSeats, setRoomSeats, setRoomPeople, reissueAgreement, ownsRoom, reviewMap,
    listRoom, createGroup, toast, activeFilterCount, raiseHint, postOpen,
    postChooserOpen, openPostChooser, closePostChooser,
    setPostOpen, submitPost, postFormRef, postDraft, post, setPost,
    postErr, editingId, groupOpen, setGroupOpen, submitGroup, grpFormRef, grpDraft,
    grp, setGrp, grpErr, myApprovedListings, myTenancies, prefillGroupFromListing,
    prefillGroupFromTenancy, openConsent, consentOpen, setConsentOpen,
    verifyOpen, setVerifyOpen, onVerified, reportTarget, setReportTarget,
    feedFailed, feedError, retryFeeds,
  } = useFlatmates();
  return (
    <div ref={rootRef} className="sf-page">
      <div className="pt-6 pb-20 min-h-[100dvh]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <Hero onPost={openPostChooser} user={user} isVerified={isVerified} openVerify={openVerify} />

          {/* Filter strip — category tabs are merged into the card as one deck */}
          <FilterBar filters={filters} setF={setF} viewMode={viewMode} setViewMode={setViewMode} seg={seg} budgetLbl={budgetLbl} smartSearchFlat={smartSearchFlat} setFilters={setFilters} emptyFilters={emptyFilters} tab={tab} sortMode={sortMode} onSort={onSort} onReset={clearFilters} tabs={flatmateTabs} />

          {/* Map view */}
          {viewMode === 'map' ? (
            mapGated ? (
              <FlatmateMapGate
                areas={gateAreas}
                selected={mapAreas}
                onToggle={toggleMapArea}
                maxAreas={MAP_MAX_AREAS}
                onSwitchList={() => setViewMode('list')}
                kindWord={kindWord}
                filters={filters}
                setF={setF}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
              />
            ) : Object.keys(mapItems).length === 0 ? (
              <Empty
                icon="map-pin"
                title={filters.near ? t('flatmates.noKindNearPlace', { kind: t('flatmates.kind_' + kindWord), place: filters.nearLabel || t('flatmates.thatPlace') }) : t('flatmates.noKindFocused', { kind: t('flatmates.kind_' + kindWord) })}
                text={filters.near ? t('flatmates.widenRadius') : t('flatmates.widenBudgetArea')}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
              />
            ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs text-gray-500 flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5" /> {t('flatmates.mapInfo', { kind: t('flatmates.kind_' + kindWord) })}</p>
                {filters.near ? (
                  <button type="button" onClick={() => setF({ near: '', nearLabel: '', nearRadius: 5, nearMode: 'km' })} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/12 border border-teal-400/30 text-teal-200 text-[11px] font-medium hover:bg-rose-500/15 hover:border-rose-400/40 hover:text-rose-200 t-all">
                    <Icon name="map-pinned" className="w-3 h-3" /> {t('flatmates.nearChip', { label: filters.nearLabel || t('flatmates.placeWord'), radius: filters.nearRadius, unit: filters.nearMode === 'km' ? t('flatmates.unitKm') : t('flatmates.unitMin') })} <Icon name="x" className="w-3 h-3" />
                  </button>
                ) : (
                  <button type="button" onClick={() => setMapAreas(new Set())} className="text-[11px] font-medium text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"><Icon name="rotate-ccw" className="w-3 h-3" /> {t('flatmates.changeAreas')}</button>
                )}
              </div>
              <Suspense fallback={<div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" /></div>}>
                <FlatmateMap
                  items={mapItems}
                  tab={tab}
                  kindWord={kindWord}
                  onFilter={(l) => setF({ locality: l })}
                  onInterest={onInterest}
                  onRoomInterest={onRoomInterest}
                  onJoin={onJoin}
                  onSave={onSave}
                  saved={saved}
                  interestedFor={interestedFor}
                  goToPosting={goToPosting}
                />
              </Suspense>
            </div>
            )
          ) : (
            <Results tab={tab} myPost={myPost} openPostModal={openPostModal} markFilled={markFilled} deleteMyRequest={deleteMyRequest} activeList={activeList} otherCount={otherCount} onSwitchTab={switchTab} saved={saved} onSave={onSave} interests={interests} onInterest={onInterest} onRoomInterest={onRoomInterest} onReport={onReport} onJoin={onJoin} ownsGroup={ownsGroup} onDeleteGroup={deleteGroup} onSeatsChange={setGroupSeats} onRoomSeatsChange={setRoomSeats} onRoomPeopleChange={setRoomPeople} onReissueAgreement={reissueAgreement} ownsRoom={ownsRoom} reviews={reviewMap} filtersActive={filtersActive} onClearFilters={clearFilters} onPost={openPostChooser} filters={filters} toast={toast} activeFilterCount={activeFilterCount} raiseHint={raiseHint} onRaiseBudget={() => raiseHint && setF({ budget: raiseHint.budget })} feedFailed={feedFailed} feedError={feedError} onRetryFeeds={retryFeeds} />
          )}
        </div>
      </div>

      {/* One posting entry point — routes by "do you have a place?" */}
      {postChooserOpen && (
        <PostChooser
          onClose={closePostChooser}
          onHasPlace={() => { closePostChooser(); listRoom(); }}
          onSolo={() => { closePostChooser(); openPostModal(); }}
          onGroup={() => { closePostChooser(); createGroup(); }}
        />
      )}

      {/* Post request modal */}
      {postOpen && (
        <PostModal setPostOpen={setPostOpen} submitPost={submitPost} postFormRef={postFormRef} postDraft={postDraft} post={post} setPost={setPost} postErr={postErr} editingId={editingId} seg={seg} />
      )}

      {/* Create group modal */}
      {groupOpen && (
        <GroupModal setGroupOpen={setGroupOpen} submitGroup={submitGroup} grpFormRef={grpFormRef} grpDraft={grpDraft} grp={grp} setGrp={setGrp} grpErr={grpErr} myListings={myApprovedListings} myTenancies={myTenancies} onAttachProperty={prefillGroupFromListing} onAttachTenancy={prefillGroupFromTenancy} onRequestConsent={openConsent} />
      )}

      {/* Owner-consent OTP ping (tenant replacement track) */}
      {consentOpen && (
        <OwnerConsentModal
          ownerMobile={grp.consentMobile}
          byMobile={user ? user.mobile : ''}
          onClose={() => setConsentOpen(false)}
          onVerified={() => { setGrp((g) => ({ ...g, consentVerified: true })); toast(t('flatmates.ownerConsentConfirmedToast'), 'success'); }}
        />
      )}

      {/* Verify seeker modal */}
      {verifyOpen && (
        <AadhaarVerifyModal
          source="flatmates"
          subtitle={t('flatmates.verifySubtitle')}
          onClose={() => setVerifyOpen(false)}
          onVerified={onVerified}
        />
      )}

      {/* Report post modal — shared platform-wide component.

          `share`, not `user`: this modal ships SHARE_REPORT_REASONS, and the server validates the
          reason against the target type. `filled` is not something you can say about a person, so
          every flatmate report was a 400 waiting to happen — the mock stored it anyway, which is
          why it survived. A room, a group and a seeker are all *posts*. */}
      {reportTarget && (
        <ReportModal
          target={reportTarget}
          kind={reportTarget.kind || 'share'}
          reasons={SHARE_REPORT_REASONS}
          title={t('flatmates.reportTitle')}
          success={t('flatmates.reportSuccess')}
          onClose={() => setReportTarget(null)}
          toast={toast}
        />
      )}
    </div>
  );
}
