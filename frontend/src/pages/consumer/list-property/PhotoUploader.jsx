import { Check, Circle, CloudUpload, Loader2, Plus, RotateCcw, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Select from '../../../components/ui/Select';
import { FieldError } from './controls.jsx';
import { lbl3 } from './styles.js';
import { photoCategoriesFor, keyPhotoCategoriesFor, MIN_PUBLISH_PHOTOS, MIN_PUBLISH_KEY_CATEGORIES } from './constants.js';
import { PHOTO_ACCEPT, PHOTO_GUIDANCE_KEY, CAMERA_GUIDANCE_KEY } from '../../../lib/uploads/policy.js';
import usePhotoLimit from '../../../lib/uploads/usePhotoLimit.js';

const photoId = (p, i) => p.id || p.url || `photo-${i}`;
const photoCollision = (args) => {
  const pointerHits = pointerWithin(args);
  return pointerHits.length ? pointerHits : closestCenter(args);
};

const fromTileBody = (listeners = {}) => Object.fromEntries(Object.entries(listeners).map(([name, handler]) => [name, (event) => {
  if (!event.currentTarget.contains(event.target) || event.target.closest('button, input, .dz-dropdown')) return;
  handler(event);
}]));

function SortablePhoto({ id, disabled, label, roleDescription, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id, disabled, attributes: { role: 'group', roleDescription },
  });
  const ref = (node) => { setNodeRef(node); setActivatorNodeRef(node); };
  return (
    <div
      ref={ref}
      {...attributes}
      {...fromTileBody(listeners)}
      aria-label={label}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl overflow-hidden bg-white/[0.04] border select-none [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${disabled ? '' : 'cursor-grab'} ${isDragging ? 'relative z-10 border-teal-400/70 shadow-2xl shadow-black/60 cursor-grabbing' : 'border-white/[0.08]'}`}
    >
      {children}
    </div>
  );
}

const PhotoUploader = ({
  form, photos, handlePhotoUpload, removePhoto, setPhotoCategory, error,
  label, hint, isMediaBusy = false, mediaStatus = '',
}) => {
  const { t } = useTranslation();
  const maxPhotos = usePhotoLimit();
  const PHOTO_CATS = photoCategoriesFor(form.propertyType, form.commercialType);
  const KEY_CATS = keyPhotoCategoriesFor(form.propertyType, form.commercialType);
  const uploadedCount = photos.filter((p) => p?.url && !p.error).length;
  const hasCat = (k) => photos.some((p) => p.url && p.category === k);
  const disabled = isMediaBusy || photos.length >= maxPhotos;
  const movePhoto = (from, to) => {
    if (isMediaBusy || from === to || to < 0 || to >= photos.length) return;
    setPhotoCategory('__move', { from, to });
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = photos.map(photoId);
  const count = photos.length;
  const position = (id) => ids.indexOf(id) + 1;
  const onDragEnd = ({ active, over }) => { if (over) movePhoto(ids.indexOf(active.id), ids.indexOf(over.id)); };
  const accessibility = {
    screenReaderInstructions: { draggable: t('listProperty.photoUx.dragKeyboard') },
    announcements: {
      onDragStart: ({ active }) => t('listProperty.photoUx.picked', { from: position(active.id), count }),
      onDragOver: ({ over }) => (over ? t('listProperty.photoUx.over', { to: position(over.id), count }) : undefined),
      onDragEnd: ({ over }) => (over ? t('listProperty.photoUx.dropped', { to: position(over.id), count }) : undefined),
      onDragCancel: ({ active }) => t('listProperty.photoUx.cancelled', { from: position(active.id) }),
    },
  };
  const ERROR_COPY = {
    min: ['listProperty.err.photosMin', { count: MIN_PUBLISH_PHOTOS }],
    max: ['listProperty.err.photosMax', { count: maxPhotos }],
    categories: ['listProperty.err.photosKeyCats', { count: Math.min(MIN_PUBLISH_KEY_CATEGORIES, KEY_CATS.length), cats: KEY_CATS.join(', ') }],
  };
  const errorCopy = ERROR_COPY[error] || ['listProperty.photoUploader.errorAddPhoto', {}];
  return (
    <div className="mb-6" data-err="photos" aria-busy={isMediaBusy}>
      <label className={lbl3}>{label || t('listProperty.photoUploader.defaultLabel')}</label>
      {hint && <p className="text-gray-500 text-xs mb-3">{hint}</p>}

      <label className={`upload-zone rounded-2xl p-5 text-center block focus-within:ring-2 focus-within:ring-teal-400 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${error ? 'dz-invalid' : ''}`}>
        <input type="file" className="sr-only" multiple accept={PHOTO_ACCEPT} disabled={disabled} aria-label={t('listProperty.photoUx.photoPicker')} onChange={handlePhotoUpload} />
        <div className="w-12 h-12 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center mx-auto mb-2.5"><CloudUpload className="w-6 h-6 text-teal-400" /></div>
        <p className="text-white font-medium text-sm mb-0.5">{t('listProperty.photoUploader.addPhoto')}</p>
        <p className="text-gray-400 text-xs">{t(PHOTO_GUIDANCE_KEY, { max: maxPhotos })}</p>
      </label>
      <p className="text-gray-400 text-xs mt-2 leading-relaxed">{t(CAMERA_GUIDANCE_KEY)}</p>
      <p className="text-teal-300 text-xs mt-2" role="status">{mediaStatus || `${uploadedCount} / ${maxPhotos} photos`}</p>
      {error && <FieldError show>{t(...errorCopy)}</FieldError>}

      {photos.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 mt-4 mb-3">
            {KEY_CATS.map((k) => (
              <span key={k} className={`text-[11px] px-2.5 py-1 rounded-full border flex items-center gap-1 ${hasCat(k) ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-white/5 border-white/10 text-gray-400'}`}>
                {hasCat(k) ? <Check className="w-3 h-3" /> : <Circle className="w-3 h-3" />} {k}
              </span>
            ))}
            <span className="text-[11px] px-2.5 py-1 text-gray-500 self-center">{t('listProperty.photoUploader.photoCount', { count: uploadedCount })}</span>
          </div>

          {count > 1 && <p className="text-gray-400 text-xs mb-2">{t('listProperty.photoUx.dragHint')}</p>}
          <DndContext sensors={sensors} collisionDetection={photoCollision} onDragEnd={onDragEnd} accessibility={accessibility}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {photos.map((p, i) => (
              <SortablePhoto
                key={ids[i]}
                id={ids[i]}
                disabled={isMediaBusy || p.uploading}
                label={t('listProperty.photoUx.tileLabel', { n: i + 1, count })}
                roleDescription={t('listProperty.photoUx.roleDescription')}
              >
                <div className="relative h-[122px] group">
                  {(p.url || p.previewUrl) && <img src={p.url || p.previewUrl} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />}
                  {i === 0 && !p.error && <span className="absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-500 text-white">{t('listProperty.photoUploader.cover')}</span>}
                  {p.uploading && (
                    <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white text-xs gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> {t('listProperty.photoUx.uploading')}
                    </div>
                  )}
                  {/* The button keeps its 44px touch target; only the disc inside it is drawn. */}
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
                  {!p.uploading && !p.error && i > 0 && (
                    <button
                      type="button"
                      disabled={isMediaBusy}
                      onClick={() => setPhotoCategory('__cover', i)}
                      aria-label={t('listProperty.photoUx.setAsCover')}
                      className="absolute top-0 left-0 w-11 h-11 flex items-center justify-center text-white"
                    >
                      <span className="w-7 h-7 rounded-full bg-black/55 flex items-center justify-center"><Star className="w-3.5 h-3.5" /></span>
                    </button>
                  )}
                  {!p.uploading && !p.error && (
                    <>
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
                    </>
                  )}
                </div>
                {p.error && (
                  <div className="p-2 text-xs text-red-200">
                    <p>{p.error}</p>
                    <button type="button" disabled={isMediaBusy} onClick={() => setPhotoCategory('__retry', i)} className="mt-2 min-h-[44px] inline-flex items-center gap-1 text-teal-200 disabled:opacity-50 disabled:cursor-not-allowed">
                      <RotateCcw className="w-3.5 h-3.5" /> {t('listProperty.photoUx.retry')}
                    </button>
                  </div>
                )}
              </SortablePhoto>
            ))}
            {photos.length < maxPhotos && <label className="rounded-xl border border-dashed border-white/15 hover:border-teal-400/50 flex flex-col items-center justify-center h-[122px] text-gray-500 hover:text-teal-400 transition-all cursor-pointer focus-within:ring-2 focus-within:ring-teal-400">
              <input type="file" className="sr-only" multiple accept={PHOTO_ACCEPT} disabled={disabled} aria-label={t('listProperty.photoUploader.addPhoto')} onChange={handlePhotoUpload} />
              <Plus className="w-6 h-6 mb-1" />
              <span className="text-xs">{t('listProperty.photoUploader.addPhoto')}</span>
            </label>}
          </div>
          </SortableContext>
          </DndContext>
          {uploadedCount < 3 && <p className="text-teal-300 text-xs mt-2">{t('listProperty.photoUploader.threePhotoHint')}</p>}
        </>
      )}
    </div>
  );
};

export default PhotoUploader;
