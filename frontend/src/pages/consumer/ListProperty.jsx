import { Sparkles, CheckCircle2, LayoutDashboard } from 'lucide-react';
import '../../styles/routes/list-property.css';
import useListProperty from './list-property/useListProperty';
import ListPropertyModals from './list-property/ListPropertyModals';
import ProgressMeter from './list-property/ProgressMeter.jsx';
import StepNav from './list-property/StepNav.jsx';
import EditPolicyBanner from './list-property/EditPolicyBanner.jsx';
import ListingPaywall from './list-property/ListingPaywall.jsx';
import PropertyDetailsStep from './list-property/PropertyDetailsStep.jsx';
import LocationPricingStep from './list-property/LocationPricingStep.jsx';
import PhotosDocumentsStep from './list-property/PhotosDocumentsStep.jsx';
import FlatmateFlow from './list-property/FlatmateFlow.jsx';
import PostSuccessVerifyNudge from './list-property/PostSuccessVerifyNudge.jsx';
import PostSuccessSplitNudge from './list-property/PostSuccessSplitNudge.jsx';

const ListProperty = () => {
  const vm = useListProperty();
  const {
    t, navigate, showSuccess, isFlatmateMode, editId, editApproved, editChanges,
    postedListing,
    progressState, canPost,
    activeListingCount, listingLimit, currentStep, setCurrentStep,
    form, set, setForm, changePropertyType, rentMode, setRentMode, errors,
    isResidential, isLand, isCommercial, isHouse, isPg,
    toggleInArray, toggleTenant, nextStep, prevStep, money, setDepositMonths, openResetConfirm,
    mapSearch, onMapSearchChange, doMapSearch, runMapSearch, mapSearchStatus, onAreaSelect,
    geoFillStatus, flyTo, onLocalityChange, onPinMove, locationSet,
    photos, handlePhotoUpload, removePhoto, setPhotoCategory,
    video, videoName, handleVideoUpload, setVideo, setVideoName,
    documents, handleDocUpload, submitProperty, submitFlatmate,
  } = vm;

  /* ================= SUCCESS ================= */
  if (showSuccess) {
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
                  : editApproved && editChanges?.recheck?.length
                    ? t('listProperty.success.editApprovedBody')
                    : t('listProperty.success.editBody'))
              : t('listProperty.success.newBody')}
          </p>
          <button onClick={() => navigate('/dashboard')} className="btn-teal inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-white font-semibold text-sm">
            <LayoutDashboard className="w-4 h-4" /> {t('listProperty.success.goToListings')}
          </button>

          {/* C1 growth lever: offer the opt-in Verified badge only for a brand-new property
              post — at the value moment (listing is already live), never as a gate. */}
          {(!editId && !isFlatmateMode) && <PostSuccessVerifyNudge t={t} />}

          {/* A rent listing can also be let one room at a time. Offered here, while
              the owner is still thinking about how to fill it. */}
          {postedListing && <PostSuccessSplitNudge listing={postedListing} />}
        </div>
      </div>
    );
  }

  return (
    <div className="lp-page min-h-[100dvh] pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-8">

        {/* Page header.

            The badge and the subtitle are desktop-only. They are motivational copy
            — "List with PuneNest", "Reach thousands of genuine buyers" — aimed at
            someone deciding *whether* to post. By the time this route renders that
            decision is already made: the user tapped Post. On a 360x640 phone the
            full header plus the progress meter and step tabs pushed the first form
            field entirely below the fold, so the most commercially important flow in
            the app opened on an advert for itself. The heading stays at every width;
            it is the only part that says which page this is. */}
        <div className="text-center mb-5 sm:mb-10">
          <div className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-5">
            <Sparkles className="w-4 h-4" /> {t('listProperty.page.badge')}
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-0 sm:mb-3">{t('listProperty.page.title')}</h1>
          <p className="hidden sm:block text-gray-400 text-lg">{t('listProperty.page.subtitle')}</p>
        </div>

        {/* Momentum meter — reflects listing-field completion. Posting requires
           only a signed-in (mobile-verified) account; identity verification is an
           opt-in "Verified" badge, never a wall (ADR-019). */}
        <ProgressMeter pct={progressState.pct} tierKey={progressState.key} label={progressState.label} cheer={progressState.cheer} />

        {editId && <EditPolicyBanner approved={editApproved} changes={editChanges} />}

        {(!editId && !canPost) ? (
          <ListingPaywall count={activeListingCount()} limit={listingLimit()} />
        ) : (<>
            {/* Step indicator — the same 3-phase wizard for whole-place & flatmate */}
            <StepNav current={currentStep} onJump={(n) => { setCurrentStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />

            {/* ===== Form Card ===== */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 lg:p-10">

              {/* -------- STEP 1 -------- */}
              {(currentStep === 1) && (
                <PropertyDetailsStep
                  form={form}
                  set={set}
                  onPropertyType={changePropertyType}
                  rentMode={rentMode}
                  setRentMode={setRentMode}
                  isFlatmateMode={isFlatmateMode}
                  errors={errors}
                  isResidential={isResidential}
                  isLand={isLand}
                  isCommercial={isCommercial}
                  isHouse={isHouse}
                  isPg={isPg}
                  toggleInArray={toggleInArray}
                  nextStep={nextStep}
                  money={money}
                  onReset={openResetConfirm}
                />
              )}

              {/* -------- STEP 2 -------- */}
              {(currentStep === 2 && !isFlatmateMode) && (
                <LocationPricingStep
                  form={form}
                  set={set}
                  setForm={setForm}
                  errors={errors}
                  isLand={isLand}
                  isCommercial={isCommercial}
                  money={money}
                  mapSearch={mapSearch}
                  onMapSearchChange={onMapSearchChange}
                  doMapSearch={doMapSearch}
                  runMapSearch={runMapSearch}
                  mapSearchStatus={mapSearchStatus}
                  onAreaSelect={onAreaSelect}
                  geoFillStatus={geoFillStatus}
                  flyTo={flyTo}
                  onLocalityChange={onLocalityChange}
                  onPinMove={onPinMove}
                  locationSet={locationSet}
                  setDepositMonths={setDepositMonths}
                  toggleTenant={toggleTenant}
                  prevStep={prevStep}
                  nextStep={nextStep}
                  onReset={openResetConfirm}
                />
              )}

              {/* -------- STEP 3 -------- */}
              {(currentStep === 3 && !isFlatmateMode) && (
                <PhotosDocumentsStep
                  form={form}
                  set={set}
                  errors={errors}
                  toggleInArray={toggleInArray}
                  photos={photos}
                  handlePhotoUpload={handlePhotoUpload}
                  removePhoto={removePhoto}
                  setPhotoCategory={setPhotoCategory}
                  video={video}
                  videoName={videoName}
                  handleVideoUpload={handleVideoUpload}
                  setVideo={setVideo}
                  setVideoName={setVideoName}
                  documents={documents}
                  handleDocUpload={handleDocUpload}
                  prevStep={prevStep}
                  submitProperty={submitProperty}
                  onReset={openResetConfirm}
                />
              )}

              {/* -------- STEPS 2 & 3 (flatmate) -------- */}
              {(isFlatmateMode && (currentStep === 2 || currentStep === 3)) && (
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
                  prevStep={prevStep}
                  nextStep={nextStep}
                  submitFlatmate={submitFlatmate}
                  onReset={openResetConfirm}
                  mapSearch={mapSearch}
                  onMapSearchChange={onMapSearchChange}
                  doMapSearch={doMapSearch}
                  runMapSearch={runMapSearch}
                  mapSearchStatus={mapSearchStatus}
                  onAreaSelect={onAreaSelect}
                  geoFillStatus={geoFillStatus}
                  flyTo={flyTo}
                  onLocalityChange={onLocalityChange}
                  onPinMove={onPinMove}
                  locationSet={locationSet}
                />
              )}
            </div>
            </>)}
      </div>

      <ListPropertyModals ctx={vm} />
    </div>
  );
};

export default ListProperty;
