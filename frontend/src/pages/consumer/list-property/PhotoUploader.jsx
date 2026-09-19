import { CloudUpload, X, Check, Circle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import { FieldError } from './controls.jsx';
import { lbl3 } from './styles.js';
import { photoCategoriesFor, keyPhotoCategoriesFor, MIN_PUBLISH_PHOTOS, MIN_PUBLISH_KEY_CATEGORIES } from './constants.js';
import { MAX_PHOTOS, PHOTO_ACCEPT, PHOTO_GUIDANCE_KEY, CAMERA_GUIDANCE_KEY } from '../../../lib/uploads/policy.js';

// Both posting flows share the same gallery policy and category controls.
const PhotoUploader = ({
  form, photos, handlePhotoUpload, removePhoto, setPhotoCategory, error,
  label, hint, isMediaBusy = false, mediaStatus = '',
}) => {
  const { t } = useTranslation();
  const PHOTO_CATS = photoCategoriesFor(form.propertyType, form.commercialType);
  const KEY_CATS = keyPhotoCategoriesFor(form.propertyType, form.commercialType);
  const hasCat = (k) => photos.some((p) => p.category === k);
  const disabled = isMediaBusy || photos.length >= MAX_PHOTOS;
  /* The validator reports a code, not a sentence: it holds the counts but has no `t`, so only this
     side can say the rule in the reader's language. */
  const ERROR_COPY = {
    min: ['listProperty.err.photosMin', { count: MIN_PUBLISH_PHOTOS }],
    max: ['listProperty.err.photosMax', { count: MAX_PHOTOS }],
    categories: ['listProperty.err.photosKeyCats', { count: Math.min(MIN_PUBLISH_KEY_CATEGORIES, KEY_CATS.length), cats: KEY_CATS.join(', ') }],
  };
  const errorCopy = ERROR_COPY[error] || ['listProperty.photoUploader.errorAddPhoto', {}];
  return (
    <div className="mb-6" data-err="photos" aria-busy={isMediaBusy}>
      <label className={lbl3}>{label || t('listProperty.photoUploader.defaultLabel')}</label>
      {hint && <p className="text-gray-500 text-xs mb-3">{hint}</p>}
      {/* One control, not two. A separate `capture="environment"` button existed to reach the rear
         camera, but an accept list that is entirely image types already makes iOS and Android offer
         Take Photo alongside the library in this picker — and only this one can take several at once. */}
      <label className={`upload-zone rounded-2xl p-5 text-center block focus-within:ring-2 focus-within:ring-teal-400 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${error ? 'dz-invalid' : ''}`}>
        <input type="file" className="sr-only" multiple accept={PHOTO_ACCEPT} disabled={disabled} aria-label="Upload property photos" onChange={handlePhotoUpload} />
        <div className="w-12 h-12 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center mx-auto mb-2.5"><CloudUpload className="w-6 h-6 text-teal-400" /></div>
        <p className="text-white font-medium text-sm mb-0.5">{t('listProperty.photoUploader.addPhoto')}</p>
        <p className="text-gray-400 text-xs">{t(PHOTO_GUIDANCE_KEY)}</p>
      </label>
      <p className="text-gray-400 text-xs mt-2 leading-relaxed">{t(CAMERA_GUIDANCE_KEY)}</p>
      <p className="text-teal-300 text-xs mt-2" role="status">{mediaStatus || `${photos.length} / ${MAX_PHOTOS} photos`}</p>
      {error && <FieldError show>{t(...errorCopy)}</FieldError>}

      {photos.length > 0 && (
        <>
          {/* Category meter */}
          <div className="flex flex-wrap gap-2 mt-4 mb-3">
            {KEY_CATS.map((k) => (
              <span key={k} className={`text-[11px] px-2.5 py-1 rounded-full border flex items-center gap-1 ${hasCat(k) ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                {hasCat(k) ? <Check className="w-3 h-3" /> : <Circle className="w-3 h-3" />} {k}
              </span>
            ))}
            <span className="text-[11px] px-2.5 py-1 text-gray-500 self-center">{t('listProperty.photoUploader.photoCount', { count: photos.length })}</span>
          </div>

          {/* Photo grid with category dropdowns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {photos.map((p, i) => (
              <div key={i} className="rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.08]">
                <div className="relative h-[122px] group">
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <span className="absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-500 text-white">{t('listProperty.photoUploader.cover')}</span>}
                  {/* The button keeps its 44px touch target; only the disc inside it is drawn, so
                     the control shrank by half visually without becoming hard to hit on a phone. */}
                  <button
                    type="button"
                    disabled={isMediaBusy}
                    onClick={() => { if (window.confirm(t('listProperty.photoUploader.confirmRemove'))) removePhoto(i); }}
                    aria-label={t('listProperty.photoUploader.remove')}
                    className="absolute top-0 right-0 sm:top-1 sm:right-1 w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center group/rm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                  >
                    <span className="w-[22px] h-[22px] sm:w-5 sm:h-5 rounded-full bg-red-500/40 backdrop-blur-[2px] flex items-center justify-center text-white group-hover/rm:bg-red-500/70 transition-colors">
                      <X className="w-3 h-3" />
                    </span>
                  </button>
                  {/* Category picker sits ON the photo — a scrim keeps it legible over
                      any image while it reads as part of the thumbnail, not a strip below. */}
                  <div className="absolute inset-x-0 bottom-0 pt-6 bg-gradient-to-t from-black/75 to-transparent pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1">
                    <Select
                      size="sm"
                      value={p.category || 'Other'}
                      onChange={(v) => setPhotoCategory(i, v)}
                      options={PHOTO_CATS}
                      ariaLabel={t('listProperty.photoUploader.photoCategoryAria')}
                      className="w-full dz-dd-photocat"
                    />
                  </div>
                </div>
              </div>
            ))}
            {/* Add photo tile */}
            {photos.length < MAX_PHOTOS && <label className="rounded-xl border border-dashed border-white/15 hover:border-teal-400/50 flex flex-col items-center justify-center h-[122px] text-gray-500 hover:text-teal-400 transition-all cursor-pointer focus-within:ring-2 focus-within:ring-teal-400">
              <input type="file" className="sr-only" multiple accept={PHOTO_ACCEPT} disabled={disabled} aria-label={t('listProperty.photoUploader.addPhoto')} onChange={handlePhotoUpload} />
              <Plus className="w-6 h-6 mb-1" />
              <span className="text-xs">{t('listProperty.photoUploader.addPhoto')}</span>
            </label>}
          </div>
        </>
      )}
    </div>
  );
};

export default PhotoUploader;
