import { useMemo, useState } from 'react';
import { Check, CheckCircle2, ArrowLeft, Eye, Plus, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import StepHeader from './StepHeader.jsx';
import { FieldError, Pill } from './controls.jsx';
import PhotoUploader from './PhotoUploader.jsx';
import ListingPreview from './ListingPreview.jsx';
import { fld, lbl3 } from './styles.js';
import { amenitiesFor, isResidentialType } from './constants.js';
import { describeListing } from './describe.js';
import { listingLabels } from './submit.js';
import HeadlineField from '../../../components/ui/HeadlineField.jsx';
import VideoLinkField from './VideoLinkField.jsx';

const BEST_TIMES = ['anytime', 'morning', 'afternoon', 'evening'];

const AmenityGroup = ({ title, options, values, onToggle }) => options.length ? (
  <div>
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{title}</p>
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {options.map(({ label, Icon }) => {
        const on = values.includes(label);
        return (
          <button key={label} type="button" onClick={() => onToggle(label)} aria-pressed={on} className={`furn-tile ${on ? 'checked' : ''}`}>
            <span className="furn-check"><Check className="w-3 h-3" /></span>
            <span className="furn-icon"><Icon className="w-5 h-5" /></span>
            <span className="furn-label">{label}</span>
          </button>
        );
      })}
    </div>
  </div>
) : null;

const PhotosDocumentsStep = ({
  form, set, errors, toggleInArray,
  photos, handlePhotoUpload, removePhoto, setPhotoCategory,
  isMediaBusy, mediaStatus,
  prevStep, submitProperty, onReset, posting, onJump,
  needsAuthForMedia = false, onRequireAuth,
}) => {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftAmenity, setDraftAmenity] = useState('');
  const [amenityStatus, setAmenityStatus] = useState(null);
  const allAmenities = useMemo(() => amenitiesFor(form.propertyType, form.commercialType), [form.propertyType, form.commercialType]);
  const toggleAmenity = (label) => toggleInArray('amenities', label);
  const optionLabels = allAmenities.map((a) => a.label.toLowerCase());
  const customAmenities = (form.amenities || []).filter((v) => !optionLabels.includes(String(v).toLowerCase()));
  const addAmenity = () => {
    const label = draftAmenity.trim().replace(/\s+/g, ' ');
    if (!label) return;
    const offered = allAmenities.find((a) => a.label.toLowerCase() === label.toLowerCase());
    const target = offered?.label || label;
    if (form.amenities.some((v) => String(v).toLowerCase() === target.toLowerCase())) {
      setAmenityStatus(`“${target}” is already in your list`);
    } else {
      toggleAmenity(target);
      setAmenityStatus(`Added “${target}”`);
    }
    setDraftAmenity('');
  };
  const writeDescription = () => {
    const next = describeListing(form);
    if (!next) return;
    if (String(form.description || '').trim() && !window.confirm(t('listProperty.content.describe.replaceConfirm'))) return;
    set('description', next);
  };
  const submitLabel = t(needsAuthForMedia ? 'listProperty.deferredLogin.submitCta' : 'listProperty.photosDocs.submitProperty');
  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.photosTitle')} subtitle={t('listProperty.steps.photosSubtitle')} onReset={onReset} />

      {needsAuthForMedia ? (
        <div className="mb-6 rounded-2xl border border-teal-400/25 bg-teal-400/10 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-white">{t('listProperty.deferredLogin.mediaTitle')}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-300">{t('listProperty.deferredLogin.mediaBody')}</p>
          <button type="button" onClick={onRequireAuth} className="mt-4 btn-teal min-h-[44px] rounded-xl px-5 text-sm font-semibold text-white">
            {t('listProperty.deferredLogin.cta')}
          </button>
        </div>
      ) : (
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
      )}

      {/* The two fields that sell the place come before the optional paperwork. */}
      <div className="mb-6">
        <HeadlineField
          className="mb-6"
          value={form.title}
          onChange={(value) => set('title', value)}
          suggestion={listingLabels(form).title}
          error={errors.title ? t('listProperty.err.contactDetails') : ''}
          labelClassName={lbl3}
          inputClassName={fld}
        />
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className={lbl3}>{t('listProperty.fields.description')}</label>
          <button type="button" onClick={writeDescription} className="text-xs font-semibold text-teal-300 hover:text-teal-200">{t('listProperty.content.describe.button')}</button>
        </div>
        <textarea rows={5} value={form.description} maxLength={4000} onChange={(e) => set('description', e.target.value)}
          placeholder={t('listProperty.ph.descPlaceholder')}
          data-err="description"
          className={`${fld} resize-none ${errors.description ? 'dz-invalid' : ''}`} />
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <FieldError show={!!errors.description}>
            {errors.description === 'length' ? t('listProperty.err.descriptionLength') : t('listProperty.err.contactDetails')}
          </FieldError>
          <p className="ml-auto shrink-0 text-xs text-gray-500">{String(form.description ?? '').length}/4000</p>
        </div>

        <VideoLinkField value={form.youtubeId} onChange={(value) => set('youtubeId', value)} error={errors.youtubeId} />
      </div>

      <div className="mb-6">
        <label className={lbl3}>{t('listProperty.bestTime.label')}</label>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('listProperty.bestTime.label')}>
          {BEST_TIMES.map((v) => (
            <Pill key={v} role="radio" selected={form.bestTimeToCall === v} onClick={() => set('bestTimeToCall', v)} className="px-5 py-2.5">{t(`listProperty.bestTime.${v}`)}</Pill>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{t('listProperty.bestTime.hint')}</p>
      </div>

      {allAmenities.length > 0 && (
        <div className="mb-8">
          <label className={lbl3}>{t('listProperty.fields.amenities')}</label>
          <AmenityGroup title={t(isResidentialType(form.propertyType) ? 'listProperty.content.amenities.society' : 'listProperty.content.amenities.all')} options={allAmenities} values={form.amenities} onToggle={toggleAmenity} />
          {customAmenities.length ? (
            <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {customAmenities.map((label) => (
                <button key={label} type="button" onClick={() => toggleAmenity(label)} aria-label={`Remove ${label}`} title={`Remove ${label}`} data-custom="true" className="furn-tile checked">
                  <span className="furn-check"><X className="w-3 h-3" /></span>
                  <span className="furn-icon"><Sparkles className="w-5 h-5" /></span>
                  <span className="furn-label">{label}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex items-center gap-2 max-w-md">
            <input value={draftAmenity} onChange={(e) => setDraftAmenity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAmenity(); } }} placeholder={t('listProperty.ph.addOtherAmenity')} aria-label={t('ui.addCustom', { noun: t('listProperty.aria.amenity') })} maxLength={40} className="form-input flex-1 px-4 py-3 rounded-xl text-white text-sm" />
            <button type="button" onClick={addAmenity} disabled={!draftAmenity.trim()} className="shrink-0 inline-flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold text-teal-300 border border-teal-500/40 hover:bg-teal-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"><Plus className="w-4 h-4" /> Add</button>
          </div>
          {amenityStatus ? <p aria-live="polite" className="mt-2 text-xs font-medium text-teal-300">{amenityStatus}</p> : null}
        </div>
      )}

      <div className="flex justify-between gap-2 lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-4 sm:px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPreviewOpen(true)} disabled={posting || isMediaBusy} aria-label={t('listProperty.preview.button')} className="btn-outline px-4 py-3.5 min-h-[44px] min-w-[44px] rounded-xl text-gray-200 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"><Eye className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">{t('listProperty.preview.button')}</span></button>
          <button onClick={submitProperty} disabled={posting || isMediaBusy} aria-busy={posting || isMediaBusy} className="btn-teal px-6 sm:px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20 disabled:opacity-60 disabled:cursor-not-allowed"><CheckCircle2 className="w-4 h-4" /> {posting ? t('listProperty.photosDocs.submitting') : isMediaBusy ? t('listProperty.photosDocs.preparingFiles') : submitLabel}</button>
        </div>
      </div>

      <ListingPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        form={form}
        photos={photos}
        onEdit={(step) => { setPreviewOpen(false); onJump(step); }}
        onSubmit={() => { setPreviewOpen(false); submitProperty(); }}
        busy={posting || isMediaBusy}
        submitLabel={submitLabel}
      />
    </div>
  );
};

export default PhotosDocumentsStep;
