import { lazy, Suspense } from 'react';
import Icon from '../../components/Icon.jsx';
import Hero from './shareflat/Hero.jsx';
import FilterBar from './shareflat/FilterBar.jsx';
import ShareMapGate from './shareflat/ShareMapGate.jsx';
import Results from './shareflat/Results.jsx';
import PostModal from './shareflat/PostModal.jsx';
import GroupModal from './shareflat/GroupModal.jsx';
import VerifyModal from './shareflat/VerifyModal.jsx';
import AadhaarVerifyModal from '../../components/auth/AadhaarVerifyModal.jsx';
import OwnerConsentModal from '../../components/auth/OwnerConsentModal.jsx';
import Empty from './shareflat/Empty.jsx';
import ReportModal, { SHARE_REPORT_REASONS } from '../../components/ReportModal.jsx';
import { useShareFlat, emptyFilters, MAP_MAX_AREAS } from './shareflat/useShareFlat.jsx';
const ShareMap = lazy(() => import('./shareflat/ShareMap.jsx'));

export default function ShareFlat() {
  const {
    rootRef, t, openPostModal, user, isVerified, openVerify,
    filters, setF, viewMode, setViewMode, seg, budgetLbl,
    smartSearchFlat, setFilters, tab, sortMode, onSort, clearFilters,
    shareTabs, mapGated, gateAreas, mapAreas, toggleMapArea, kindWord,
    filtersActive, mapItems, setMapAreas, onInterest, onRoomInterest, onJoin,
    onSave, saved, interestedFor, goToPosting, myPost, markFilled,
    deleteMyRequest, seekerList, roomList, groupList, interests, onReport,
    ownsGroup, deleteGroup, setGroupSeats, setRoomSeats, ownsRoom, reviewMap,
    listRoom, createGroup, toast, activeFilterCount, raiseHint, postOpen,
    setPostOpen, submitPost, postFormRef, postDraft, post, setPost,
    postErr, editingId, groupOpen, setGroupOpen, submitGroup, grpFormRef, grpDraft,
    grp, setGrp, grpErr, myApprovedListings, myTenancies, prefillGroupFromListing,
    prefillGroupFromTenancy, openConsent, consentOpen, setConsentOpen, aadhaarGateOpen, pendingSupplyAction,
    setAadhaarGateOpen, verifyOpen, submitVerify, verifyFormRef, mobile, mobileErr,
    setMobileErr, otp, verifying, setVerifyOpen, reportTarget, setReportTarget,
  } = useShareFlat();
  return (
    <div ref={rootRef} className="sf-page">
      <main className="pt-6 pb-20 min-h-[100dvh]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <Hero openPostModal={openPostModal} user={user} isVerified={isVerified} openVerify={openVerify} />

          {/* Filter strip — category tabs are merged into the card as one deck */}
          <FilterBar filters={filters} setF={setF} viewMode={viewMode} setViewMode={setViewMode} seg={seg} budgetLbl={budgetLbl} smartSearchFlat={smartSearchFlat} setFilters={setFilters} emptyFilters={emptyFilters} tab={tab} sortMode={sortMode} onSort={onSort} onReset={clearFilters} tabs={shareTabs} />

          {/* Map view */}
          {viewMode === 'map' ? (
            mapGated ? (
              <ShareMapGate
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
                title={filters.near ? t('shareFlat.noKindNearPlace', { kind: t('shareFlat.kind_' + kindWord), place: filters.nearLabel || t('shareFlat.thatPlace') }) : t('shareFlat.noKindFocused', { kind: t('shareFlat.kind_' + kindWord) })}
                text={filters.near ? t('shareFlat.widenRadius') : t('shareFlat.widenBudgetArea')}
                filtersActive={filtersActive}
                onClearFilters={clearFilters}
              />
            ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs text-gray-500 flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5" /> {t('shareFlat.mapInfo', { kind: t('shareFlat.kind_' + kindWord) })}</p>
                {filters.near ? (
                  <button type="button" onClick={() => setF({ near: '', nearLabel: '', nearRadius: 5, nearMode: 'km' })} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/12 border border-teal-400/30 text-teal-200 text-[11px] font-medium hover:bg-rose-500/15 hover:border-rose-400/40 hover:text-rose-200 t-all">
                    <Icon name="map-pinned" className="w-3 h-3" /> {t('shareFlat.nearChip', { label: filters.nearLabel || t('shareFlat.placeWord'), radius: filters.nearRadius, unit: filters.nearMode === 'km' ? t('shareFlat.unitKm') : t('shareFlat.unitMin') })} <Icon name="x" className="w-3 h-3" />
                  </button>
                ) : (
                  <button type="button" onClick={() => setMapAreas(new Set())} className="text-[11px] font-medium text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"><Icon name="rotate-ccw" className="w-3 h-3" /> {t('shareFlat.changeAreas')}</button>
                )}
              </div>
              <Suspense fallback={<div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" /></div>}>
                <ShareMap
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
            <Results tab={tab} myPost={myPost} openPostModal={openPostModal} markFilled={markFilled} deleteMyRequest={deleteMyRequest} seekerList={seekerList} roomList={roomList} groupList={groupList} saved={saved} onSave={onSave} interests={interests} onInterest={onInterest} onRoomInterest={onRoomInterest} onReport={onReport} onJoin={onJoin} ownsGroup={ownsGroup} onDeleteGroup={deleteGroup} onSeatsChange={setGroupSeats} onRoomSeatsChange={setRoomSeats} ownsRoom={ownsRoom} reviews={reviewMap} seg={seg} filtersActive={filtersActive} onClearFilters={clearFilters} onListRoom={listRoom} onCreateGroup={createGroup} filters={filters} toast={toast} activeFilterCount={activeFilterCount} raiseHint={raiseHint} onRaiseBudget={() => raiseHint && setF({ budget: raiseHint.budget })} />
          )}
        </div>
      </main>

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
          onVerified={() => { setGrp((g) => ({ ...g, consentVerified: true })); toast(t('shareFlat.ownerConsentConfirmedToast'), 'success'); }}
        />
      )}

      {/* Aadhaar identity gate for listing a room / creating a group */}
      {aadhaarGateOpen && (
        <AadhaarVerifyModal
          subtitle={t('shareFlat.aadhaarGateSubtitle')}
          note={t('shareFlat.aadhaarGateNote')}
          onClose={() => { pendingSupplyAction.current = null; setAadhaarGateOpen(false); }}
          onVerified={() => {
            setAadhaarGateOpen(false);
            toast(t('shareFlat.identityVerified'), 'success');
            const action = pendingSupplyAction.current;
            pendingSupplyAction.current = null;
            action?.();
          }}
        />
      )}

      {/* Verify seeker modal */}
      {verifyOpen && (
        <VerifyModal setVerifyOpen={setVerifyOpen} submitVerify={submitVerify} verifyFormRef={verifyFormRef} mobile={mobile} mobileErr={mobileErr} setMobileErr={setMobileErr} otp={otp} verifying={verifying} />
      )}

      {/* Report post modal — shared platform-wide component */}
      {reportTarget && (
        <ReportModal
          target={reportTarget}
          kind={reportTarget.kind || 'user'}
          reasons={SHARE_REPORT_REASONS}
          title={t('shareFlat.reportTitle')}
          success={t('shareFlat.reportSuccess')}
          onClose={() => setReportTarget(null)}
          toast={toast}
        />
      )}
    </div>
  );
}
