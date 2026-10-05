import { Sparkles, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import '../../styles/routes/list-property.css';
import useListProperty from './list-property/useListProperty';
import ListPropertyModals from './list-property/ListPropertyModals';
import ProgressMeter from './list-property/ProgressMeter.jsx';
import StepNav, { LISTING_STEPS } from './list-property/StepNav.jsx';
import EditPolicyBanner from './list-property/EditPolicyBanner.jsx';
import ListingPaywall from './list-property/ListingPaywall.jsx';
import PropertyDetailsStep from './list-property/PropertyDetailsStep.jsx';
import LocationStep from './list-property/LocationStep.jsx';
import PricingStep from './list-property/PricingStep.jsx';
import PhotosDocumentsStep from './list-property/PhotosDocumentsStep.jsx';
import FlatmateFlow from './list-property/FlatmateFlow.jsx';
import PostSuccessSplitNudge from './list-property/PostSuccessSplitNudge.jsx';
import InlineOtpSheet from '../../components/auth/InlineOtpSheet.jsx';
import ListingStatusCard from '../../components/listing/ListingStatusCard.jsx';

const ListPropertyForm = () => {
  const vm = useListProperty();
  const {
    t, navigate, showSuccess, isFlatmateMode, flatmateMode, editId, editRoomId, editApproved, editChanges,
    postedListing, savedListingStatus, editReady, editLoading, editLoadError, retryEditLoad, legacyAddress,
    authPromptOpen, closeAuthPrompt,
    progressState, canPost,
    activeListingCount, listingLimit, currentStep, setCurrentStep,
    form, set, changePropertyType, changeCommercialType, rentMode, setRentMode, errors,
    isResidential, isLand, isCommercial, isHouse,
    toggleInArray, toggleTenant, nextStep, prevStep, dupPending, money, setDepositMonths, openResetConfirm,
    mapSearch, onMapSearchChange, runMapSearch, mapSearchStatus, onAreaSelect, onSocietyPick,
    geoFillStatus, societyFillNotice, currentLocationStatus, canUseCurrentLocation, useCurrentLocation,
    flyTo, onLocalityChange, onPinMove, locationSet,
    photos, handlePhotoUpload, removePhoto, setPhotoCategory,
    isMediaBusy, mediaStatus,
    submitProperty, submitFlatmate, posting, postAnother, amenityPrefillRef,
    needsAuthForMedia, requestAuthPrompt,
  } = vm;
  const editSavedApproved = /approved|verified|live/i.test(String(savedListingStatus || ''));
  const jumpTo = (n) => { setCurrentStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  if ((editId || editRoomId) && !editReady) {
    return (
      <div className="lp-page min-h-[100dvh] px-4 pt-8">
        <div className="glass-card rounded-2xl p-6 sm:p-8 max-w-3xl mx-auto" aria-busy={editLoading}>
          <h1 className="text-2xl font-bold text-white mb-3">{editRoomId ? t('listProperty.edit.roomTitle') : t('listProperty.edit.title', { defaultValue: 'Edit listing' })}</h1>
          <p role={editLoadError ? 'alert' : 'status'} className="text-sm text-gray-400 mb-5">
            {editRoomId
              ? t(editLoadError ? 'listProperty.edit.roomLoadError' : 'listProperty.edit.roomLoading')
              : editLoadError
              ? t('listProperty.edit.loadError', { defaultValue: 'We could not load your listing. Nothing has been changed. Please try again.' })
              : t('listProperty.edit.loading', { defaultValue: 'Loading your listing…' })}
          </p>
          {editLoadError && (
            <button type="button" onClick={retryEditLoad} className="btn-teal px-6 py-3 rounded-xl text-white font-semibold text-sm">
              {t('listProperty.edit.retry', { defaultValue: 'Try again' })}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (showSuccess) {
    const successListingId = postedListing?.id || postedListing?.uuid || editId;
    const successListing = postedListing || {
      id: successListingId,
      status: editSavedApproved && !editChanges?.remoderation?.length ? 'approved' : 'pending',
      ownershipVerified: false,
    };
    const successEditHref = successListingId ? `/list-property?edit=${successListingId}&step=photos` : '/dashboard#listings';
    const successViewHref = successListingId ? `/property/${successListingId}` : '/dashboard#listings';
    return (
      <div className="lp-page min-h-[100dvh] flex items-center justify-center p-4">
        <div className="lp-success-card glass-card rounded-2xl p-8 sm:p-10 max-w-md w-full text-center">
          <div className="lp-success-ring w-20 h-20 rounded-full bg-gradient-to-br from-teal-400/20 to-green-400/20 flex items-center justify-center mx-auto mb-6 border border-teal-400/30">
            <CheckCircle2 className="lp-success-badge w-10 h-10 text-teal-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">
            {isFlatmateMode ? t('listProperty.success.flatmateTitle') : editId ? t('listProperty.success.updatedTitle') : t('listProperty.success.postedTitle')}
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-8">
            {editId
              ? (editApproved && editChanges?.remoderation?.length
                  ? t('listProperty.success.editRemoderationBody')
                  : editSavedApproved && editChanges?.recheck?.length
                    ? t('listProperty.success.editApprovedBody')
                    : editSavedApproved
                      ? t('listProperty.success.editBody')
                      : t('listProperty.success.editReviewBody'))
              : t('listProperty.success.newBody')}
          </p>
            {/* Verification is optional and offered only after a new property is posted. */}
          {!isFlatmateMode && (
            <ListingStatusCard
              listing={successListing}
              variant="hero"
              editHref={successEditHref}
              viewHref={successViewHref}
              t={t}
              className="mb-6"
            />
          )}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button onClick={() => navigate('/dashboard#properties')} className="btn-teal inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-white font-semibold text-sm">
              <LayoutDashboard className="w-4 h-4" /> {t('listProperty.success.goToListings')}
            </button>
            {!editId && (
              <button onClick={postAnother} className="btn-outline inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-gray-200 font-semibold text-sm">
                {t('listProperty.shell.postAnother')}
              </button>
            )}
          </div>
          {/* A rent listing can also be let one room at a time. */}

          {postedListing && <PostSuccessSplitNudge listing={postedListing} />}
        </div>
      </div>
    );
  }

  return (
    <div className="lp-page min-h-[100dvh] pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-8">
        {/* Keep the first form field above the fold on small phones. */}

        <div className="text-center mb-5 sm:mb-10">
          <div className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-5">
            <Sparkles className="w-4 h-4" /> {t('listProperty.page.badge')}
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-0 sm:mb-3">{editRoomId ? t('listProperty.edit.roomTitle') : t('listProperty.page.title')}</h1>
          <p className="hidden sm:block text-gray-400 text-lg">{t('listProperty.page.subtitle')}</p>
        </div>

        <ProgressMeter
          pct={progressState.pct}
          tierKey={progressState.key}
          label={progressState.label}
          done={progressState.done}
          total={progressState.total}
          nudge={progressState.nudge}
        />

        {listingLimit != null && !editId && !isFlatmateMode && (
          <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-semibold text-gray-300">
            {activeListingCount > 0
              ? t('listProperty.quota.entryUsed', { used: activeListingCount, allowance: listingLimit })
              : t('listProperty.quota.entryAvailable', { allowance: listingLimit })}
          </p>
        )}

        {/* The freemium ceiling counts whole-property listings, and only those: a flatmate room is a `FlatmateRoom`,
           posted through `createRoom` and never measured against the allowance. */}
        {editId && <EditPolicyBanner approved={editApproved} changes={editChanges} />}

        {(!editId && !canPost && !flatmateMode) ? (
          <ListingPaywall count={activeListingCount} limit={listingLimit} />
        ) : (<>
            <StepNav current={currentStep} steps={LISTING_STEPS} onJump={jumpTo} />
            {/* Narrow mobile gutters leave room for paired fields. */}

            <div className="glass-card rounded-2xl px-3 py-6 sm:p-8 lg:p-10" data-testid="listing-wizard">

              {(currentStep === 1) && (
                <PropertyDetailsStep
                  allowFlatmate={!editId && !editRoomId}
                  lockDeal={!!editRoomId}
                  form={form}
                  set={set}
                  onPropertyType={changePropertyType}
                  onCommercialType={changeCommercialType}
                  rentMode={rentMode}
                  setRentMode={setRentMode}
                  isFlatmateMode={isFlatmateMode}
                  errors={errors}
                  isResidential={isResidential}
                  isLand={isLand}
                  isCommercial={isCommercial}
                  isHouse={isHouse}
                  toggleInArray={toggleInArray}
                  nextStep={nextStep}
                  money={money}
                  onReset={openResetConfirm}
                />
              )}

              {(currentStep === 2 && !isFlatmateMode) && (
                <LocationStep
                  form={form}
                  legacyAddress={legacyAddress}
                  set={set}
                  errors={errors}
                  isLand={isLand}
                  isCommercial={isCommercial}
                  mapSearch={mapSearch}
                  onMapSearchChange={onMapSearchChange}
                  runMapSearch={runMapSearch}
                  mapSearchStatus={mapSearchStatus}
                  onAreaSelect={onAreaSelect}
                  geoFillStatus={geoFillStatus}
                  flyTo={flyTo}
                  onLocalityChange={onLocalityChange}
                  onPinMove={onPinMove}
                  onSocietyPick={onSocietyPick}
                  societyFillNotice={societyFillNotice}
                  canUseCurrentLocation={canUseCurrentLocation}
                  useCurrentLocation={useCurrentLocation}
                  currentLocationStatus={currentLocationStatus}
                  locationSet={locationSet}
                  prevStep={prevStep}
                  nextStep={nextStep}
                  nextPending={dupPending}
                  onReset={openResetConfirm}
                />
              )}

              {(currentStep === 3 && !isFlatmateMode) && (
                <PricingStep
                  form={form}
                  set={set}
                  errors={errors}
                  isLand={isLand}
                  isCommercial={isCommercial}
                  money={money}
                  setDepositMonths={setDepositMonths}
                  toggleTenant={toggleTenant}
                  prevStep={prevStep}
                  nextStep={nextStep}
                  onReset={openResetConfirm}
                />
              )}

              {(currentStep === 4 && !isFlatmateMode) && (
                <PhotosDocumentsStep
                  form={form}
                  set={set}
                  errors={errors}
                  toggleInArray={toggleInArray}
                  photos={photos}
                  handlePhotoUpload={handlePhotoUpload}
                  removePhoto={removePhoto}
                  setPhotoCategory={setPhotoCategory}
                  isMediaBusy={isMediaBusy || posting}
                  mediaStatus={mediaStatus}
                  prevStep={prevStep}
                  submitProperty={submitProperty}
                  posting={posting}
                  onReset={openResetConfirm}
                  onJump={jumpTo}
                  isEditing={!!editId}
                  amenityPrefillRef={amenityPrefillRef}
                  needsAuthForMedia={needsAuthForMedia}
                  onRequireAuth={requestAuthPrompt}
                />
              )}

              {(isFlatmateMode && currentStep > 1) && (
                <FlatmateFlow
                  form={form}
                  set={set}
                  errors={errors}
                  money={money}
                  photos={photos}
                  handlePhotoUpload={handlePhotoUpload}
                  removePhoto={removePhoto}
                  setPhotoCategory={setPhotoCategory}
                  currentStep={currentStep}
                  isMediaBusy={isMediaBusy || posting}
                  mediaStatus={mediaStatus}
                  prevStep={prevStep}
                  nextStep={nextStep}
                  submitFlatmate={submitFlatmate}
                  isEditing={!!editRoomId}
                  onReset={openResetConfirm}
                  mapSearch={mapSearch}
                  onMapSearchChange={onMapSearchChange}
                  runMapSearch={runMapSearch}
                  mapSearchStatus={mapSearchStatus}
                  onAreaSelect={onAreaSelect}
                  onSocietyPick={onSocietyPick}
                  geoFillStatus={geoFillStatus}
                  flyTo={flyTo}
                  onLocalityChange={onLocalityChange}
                  onPinMove={onPinMove}
                  locationSet={locationSet}
                  needsAuthForMedia={needsAuthForMedia}
                  onRequireAuth={requestAuthPrompt}
                />
              )}
            </div>
            </>)}
      </div>

      <ListPropertyModals ctx={vm} />
      <InlineOtpSheet
        open={authPromptOpen}
        title={t('listProperty.deferredLogin.title')}
        subtitle={t('listProperty.deferredLogin.subtitle')}
        onClose={closeAuthPrompt}
        onVerified={closeAuthPrompt}
      />
    </div>
  );
};
// Remount per owner/listing so pending uploads, geocodes and draft timers cannot cross editors.

const ListProperty = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const editId = searchParams.get('edit');
  const editRoomId = searchParams.get('editRoom');
  const key = JSON.stringify([editId, editRoomId, (editId || editRoomId) ? (user?.id || user?.uuid || user?.mobile || '') : 'new']);
  return <ListPropertyForm key={key} />;
};

export default ListProperty;
