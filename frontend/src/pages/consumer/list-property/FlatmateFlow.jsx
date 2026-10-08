import { useState } from 'react';
import { MapPin, Users, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField';
import { FieldError } from './controls.jsx';
import StepHeader from './StepHeader.jsx';
import LocationPicker from './LocationPicker.jsx';
import AreaSearch from './AreaSearch.jsx';
import PhotoUploader from './PhotoUploader.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { isHouseType } from './constants.js';
import { cleanText } from './sanitize.js';
import { moneyWords } from './format.js';
import SocietySelect from './SocietySelect.jsx';
import { roomHeadline } from './submit.js';
import HeadlineField from '../../../components/ui/HeadlineField.jsx';

const StepActions = ({ prevStep, nextStep, t, disabled }) => (
  <div className="flex justify-between lp-step-actions">
    <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
    <button onClick={nextStep} disabled={disabled} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20 disabled:opacity-70">{t('listProperty.next')} <ArrowRight className="w-4 h-4" /></button>
  </div>
);

// A room share needs the property's address and map, but owner-only sale and lease terms
// do not apply to a sitting tenant or room host.
const FlatmateFlow = ({
  form, set, errors, money,
  photos, handlePhotoUpload, removePhoto, setPhotoCategory,
  isMediaBusy, mediaStatus,
  currentStep, prevStep, nextStep, submitFlatmate, onReset, isEditing = false,
  mapSearch, onMapSearchChange, runMapSearch, mapSearchStatus, geoFillStatus,
  flyTo, onLocalityChange, onPinMove, locationSet, onAreaSelect, onSocietyPick,
  needsAuthForMedia = false, onRequireAuth,
}) => {
  const { t } = useTranslation();
  const [localityBusy, setLocalityBusy] = useState(false);
  const isHouse = isHouseType(form.propertyType);
  if (currentStep === 2) {
    return (
      <div className="lp-step">
        <StepHeader title={t('listProperty.steps.flatmateLocationTitle')} subtitle={t('listProperty.steps.flatmateLocationSubtitle')} onReset={onReset} />

        {/* Keep the map before the address: auto-fill must run before manual edits. */}
        <div className="mb-6" data-err="location">
          <label className={`${lbl} mb-1`}>{t('listProperty.fields.pinFlatLocation')}</label>
          <div className="mb-2">
            <AreaSearch
              value={mapSearch}
              onChange={onMapSearchChange}
              onRunSearch={runMapSearch}
              onSelectPlace={onAreaSelect}
              status={mapSearchStatus}
              placeholder={t('listProperty.ph.areaSearch')}
            />
          </div>
          <div style={{ height: 280, borderRadius: 14, overflow: 'hidden', border: `1px solid ${errors.location ? 'rgb(var(--dz-c-red-400) / .6)' : 'rgb(var(--dz-c-white) / .1)'}` }}>
            <LocationPicker lat={form.propLat} lng={form.propLng} flyTo={flyTo} onMove={(la, ln) => onPinMove(la, ln)} />
          </div>
          {locationSet ? (
            <p className="text-emerald-300/90 text-xs mt-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-emerald-400" /> {t('listProperty.help.locationSet', { lat: Number(form.propLat).toFixed(4), lng: Number(form.propLng).toFixed(4) })}
            </p>
          ) : (
            <p className="text-gray-500 text-xs mt-2">
              <MapPin className="w-3 h-3 inline text-teal-400" /> {t('listProperty.help.searchOrDragFlat')}
            </p>
          )}
          {geoFillStatus === 'filling' && <p className="text-gray-500 text-xs mt-1.5">{t('listProperty.help.fillingAddress')}</p>}
          {geoFillStatus === 'done' && <p className="text-teal-300/80 text-xs mt-1.5 flex items-center gap-1.5"><MapPin className="w-3 h-3 text-teal-400" /> {t('listProperty.help.filledAddress')}</p>}
          <FieldError show={!!errors.location}>{t('listProperty.err.locationFlat')}</FieldError>
        </div>

        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>{t('listProperty.fields.locality')}</label>
            <LocalitySelect value={form.locality} onChange={(v) => onLocalityChange(v)} onSelect={(sel) => onLocalityChange(sel.name, sel)} onBusyChange={setLocalityBusy} placeholder={t('listProperty.ph.selectLocality')} dataErr="locality" invalid={!!errors.locality} />
            <FieldError show={!!errors.locality}>{t('listProperty.err.locality')}</FieldError>
          </div>
          <div>
            <label className={lbl}>{isHouse ? t('listProperty.fields.houseBuildingName') : t('listProperty.fields.societyBuilding')}</label>
            <SocietySelect value={form.societyId} name={form.society} notOnMaps={form.societyNotOnMaps} localityLabel={form.locality} lat={form.pinPlaced ? form.propLat : null} lng={form.pinPlaced ? form.propLng : null} invalid={!!errors.society} onChange={onSocietyPick} onRequireAuth={onRequireAuth} />
            <FieldError show={!!errors.society}>{isHouse ? t('listProperty.err.house') : t('listProperty.err.society')}</FieldError>
          </div>
          <div>
            <label className={lbl}>{isHouse ? t('listProperty.fields.housePlotNo') : t('listProperty.fields.flatUnitNo')}</label>
            <input value={form.flatNumber} maxLength={20} onChange={(e) => set('flatNumber', cleanText(e.target.value))} placeholder={isHouse ? t('listProperty.ph.eg24b') : t('listProperty.ph.egBUnit')} className={fld} />
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.towerBlock')}</label>
            <input value={form.tower} maxLength={30} onChange={(e) => set('tower', cleanText(e.target.value))} placeholder={t('listProperty.ph.egTowerB')} className={fld} />
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.streetRoad')}</label>
            <input value={form.street} maxLength={60} onChange={(e) => set('street', cleanText(e.target.value))} placeholder={t('listProperty.ph.egBanerRoad')} className={fld} />
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.landmark')}</label>
            <input value={form.landmark} maxLength={60} onChange={(e) => set('landmark', cleanText(e.target.value))} placeholder={t('listProperty.ph.egDMart')} className={fld} />
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.pincode')}</label>
            <input inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} placeholder="411045" className={fld} />
          </div>
        </div>

        <StepActions prevStep={prevStep} nextStep={nextStep} t={t} disabled={localityBusy} />
      </div>
    );
  }

  if (currentStep === 3) {
    return (
      <div className="lp-step">
        <StepHeader title={t('listProperty.steps.flatmatePriceTitle')} subtitle={t('listProperty.steps.flatmatePriceSubtitle')} onReset={onReset} />

        <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>{t('listProperty.fields.roomRent')}</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
              <input inputMode="numeric" maxLength={10} {...money('rentShare')} data-err="rentShare" placeholder={t('listProperty.ph.egRentShare')} className={`${fld} pl-10 pr-14 ${errors.rentShare ? 'dz-invalid' : ''}`} />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMo')}</div>
            </div>
            <FieldError show={!!errors.rentShare}>{t('listProperty.err.rentShare')}</FieldError>
            {moneyWords(form.rentShare) && <p className="mt-1.5 ml-1 text-xs text-gray-500">{moneyWords(form.rentShare)}</p>}
            {form.roomType === 'Shared room' && Number(form.rentShare) > 0 && (
              <p className="mt-1 ml-1 text-xs text-teal-300" data-testid="room-rent-split">{t('listProperty.help.roomRentSplit', { price: `₹${Math.round(Number(form.rentShare) / 2).toLocaleString('en-IN')}` })}</p>
            )}
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.securityDeposit')}</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
              <input inputMode="numeric" maxLength={10} {...money('deposit')} placeholder={t('listProperty.ph.egDeposit28')} className={`${fld} pl-10 pr-4`} />
            </div>
            {moneyWords(form.deposit) && <p className="mt-1.5 ml-1 text-xs text-gray-500">{moneyWords(form.deposit)}</p>}
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.availableFrom')}</label>
            <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={fld} />
            <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableRoom')}</FieldError>
          </div>
        </div>

        <StepActions prevStep={prevStep} nextStep={nextStep} t={t} />
      </div>
    );
  }

  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.flatmatePhotosTitle')} subtitle={t('listProperty.steps.flatmatePhotosSubtitle')} onReset={onReset} />

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
          label={t('listProperty.photoUploader.defaultLabel')}
          hint={t('listProperty.flatmate.photosHint')}
        />
      )}

      <HeadlineField
        className="mb-6"
        value={form.title}
        onChange={(value) => set('title', value)}
        suggestion={roomHeadline(form)}
        error={errors.title ? t('common.headline.contact') : ''}
        labelClassName={lbl3}
        inputClassName={fld}
      />

      <div className="mb-8">
        <label className={lbl3}>{t('listProperty.fields.shortNote')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
        <textarea rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={t('listProperty.ph.notePlaceholder')} className={`${fld} resize-none`} />
      </div>

      <div className="flex justify-between lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <button onClick={submitFlatmate} disabled={isMediaBusy} aria-busy={isMediaBusy} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20 disabled:opacity-60 disabled:cursor-not-allowed">
          <Users className="w-4 h-4" /> {t(isEditing ? 'listProperty.edit.saveRoom' : needsAuthForMedia ? 'listProperty.deferredLogin.postCta' : 'listProperty.flatmate.postFind')}
        </button>
      </div>
    </div>
  );
};

export default FlatmateFlow;
