import { CloudUpload, X, Check, Circle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import { FieldError } from './controls.jsx';
import { lbl3 } from './styles.js';
import { photoCategoriesFor, keyPhotoCategoriesFor } from './constants.js';

/**
 * PhotoUploader — the categorized photo grid shared by the whole-place listing
 * flow (Photos & documents step) and the flatmate/room flow (Step 3).
 *
 * A room-sharer occupies the whole flat/home, so both flows want the same rich
 * grid: a cover badge on the first photo, a per-photo category dropdown, and a
 * "key categories covered" meter — categories come from the property type, so a
 * residential share offers Living Room / Kitchen / Bedroom / Bathroom, not a
 * bare uploader. Kept presentational: all photo state + handlers live in the
 * ListProperty controller and are passed down, so both flows stay in sync.
 */
const PhotoUploader = ({
  form, photos, handlePhotoUpload, removePhoto, setPhotoCategory, error,
  label, hint,
}) => {
  const { t } = useTranslation();
  const PHOTO_CATS = photoCategoriesFor(form.propertyType, form.commercialType);
  const KEY_CATS = keyPhotoCategoriesFor(form.propertyType, form.commercialType);
  const hasCat = (k) => photos.some((p) => p.category === k);
  return (
    <div className="mb-6" data-err="photos">
      <label className={lbl3}>{label || t('listProperty.photoUploader.defaultLabel')}</label>
      {hint && <p className="text-gray-500 text-xs mb-3">{hint}</p>}
      <label className={`upload-zone rounded-2xl p-5 text-center cursor-pointer block ${error ? 'pn-invalid' : ''}`}>
        <input type="file" className="hidden" multiple accept="image/*" onChange={handlePhotoUpload} />
        <div className="w-12 h-12 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center mx-auto mb-2.5"><CloudUpload className="w-6 h-6 text-teal-400" /></div>
        <p className="text-white font-medium text-sm mb-0.5">{t('listProperty.photoUploader.dropTitle')}</p>
        <p className="text-gray-500 text-xs">{t('listProperty.photoUploader.dropSub')}</p>
      </label>
      {error && <FieldError show>{t('listProperty.photoUploader.errorAddPhoto')}</FieldError>}

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
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center text-white hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="w-3 h-3" />
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
                      className="w-full pn-dd-photocat"
                    />
                  </div>
                </div>
              </div>
            ))}
            {/* Add photo tile */}
            <label className="rounded-xl border border-dashed border-white/15 hover:border-teal-400/50 flex flex-col items-center justify-center h-[122px] text-gray-500 hover:text-teal-400 transition-all cursor-pointer">
              <input type="file" className="hidden" multiple accept="image/*" onChange={handlePhotoUpload} />
              <Plus className="w-6 h-6 mb-1" />
              <span className="text-xs">{t('listProperty.photoUploader.addPhoto')}</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
};

export default PhotoUploader;
