import { CheckCircle2, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import StepHeader from './StepHeader.jsx';
import FeatureSelector from '../../../components/ui/FeatureSelector';
import PhotoUploader from './PhotoUploader.jsx';
import PropertyDocumentUploads from './PropertyDocumentUploads.jsx';
import { fld, lbl3 } from './styles.js';
import { amenitiesFor } from './constants.js';

const PhotosDocumentsStep = ({
  form, set, errors, toggleInArray,
  photos, handlePhotoUpload, removePhoto, setPhotoCategory,
  isMediaBusy, mediaStatus,
  documents, handleDocUpload, prevStep, submitProperty, onReset, posting,
}) => {
  const { t } = useTranslation();
  const amenities = amenitiesFor(form.propertyType, form.commercialType);
  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.photosTitle')} subtitle={t('listProperty.steps.photosSubtitle')} onReset={onReset} />

      <PhotoUploader
        form={form}
        photos={photos}
        handlePhotoUpload={handlePhotoUpload}
        removePhoto={removePhoto}
        setPhotoCategory={setPhotoCategory}
        error={errors.photos}
        isMediaBusy={isMediaBusy}
        mediaStatus={mediaStatus}
      />

      {/* The two fields that sell the place come before the optional paperwork: an owner who
          stops at the document block has still written the part a searcher reads. */}
      <div className="mb-6">
        <label className={lbl3}>{t('listProperty.fields.description')}</label>
        <textarea rows={5} value={form.description} onChange={(e) => set('description', e.target.value)}
          placeholder={t('listProperty.ph.descPlaceholder')}
          className={`${fld} resize-none`} />
      </div>

      {amenities.length > 0 && (
        <div className="mb-8">
          <label className={lbl3}>{t('listProperty.fields.amenities')}</label>
          <FeatureSelector
            options={amenities}
            values={form.amenities}
            onToggle={(label) => toggleInArray('amenities', label)}
            placeholder={t('listProperty.ph.addOtherAmenity')}
            addAriaLabel={t('listProperty.aria.amenity')}
          />
        </div>
      )}

      <PropertyDocumentUploads {...{ form, set, documents, errors, isMediaBusy, handleDocUpload }} />

      <div className="flex justify-between lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <button onClick={submitProperty} disabled={posting || isMediaBusy} aria-busy={posting || isMediaBusy} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20 disabled:opacity-60 disabled:cursor-not-allowed"><CheckCircle2 className="w-4 h-4" /> {posting ? t('listProperty.photosDocs.submitting') : isMediaBusy ? 'Preparing files…' : t('listProperty.photosDocs.submitProperty')}</button>
      </div>
    </div>
  );
};

export default PhotosDocumentsStep;