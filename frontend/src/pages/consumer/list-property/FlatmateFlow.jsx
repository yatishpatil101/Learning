import { MapPin, Users, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField';
import { Pill, FieldError } from './controls.jsx';
import StepHeader from './StepHeader.jsx';
import LocationPicker from './LocationPicker.jsx';
import AreaSearch from './AreaSearch.jsx';
import PhotoUploader from './PhotoUploader.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { localities, isHouseType } from './constants.js';
import { cleanText } from './sanitize.js';
import SocietySelect from './SocietySelect.jsx';

/**
 * FlatmateFlow — steps 2 & 3 of the flatmate/room posting flow.
 *
 * Reuses the SAME wizard shell, map picker, and shared controls as the
 * whole-place listing flow (Step 1 lives in PropertyDetailsStep's flatmate
 * block). A room share describes the same physical flat, so it carries the
 * same address + map; owner-only pricing clusters (preferred tenants, sale
 * type, agreement terms) are intentionally absent because they don't apply to
 * a sitting tenant / room host. The room is still persisted as a room record
 * via submitFlatmate — only the UI flow is unified, not the storage target.
 */
const FlatmateFlow = ({
  form, set, errors, money,
  photos, handlePhotoUpload, removePhoto, setPhotoCategory,
  currentStep, prevStep, nextStep, submitFlatmate, onReset,
  mapSearch, onMapSearchChange, runMapSearch, mapSearchStatus, geoFillStatus,
  flyTo, onLocalityChange, onPinMove, locationSet, onAreaSelect,
}) => {
  const { t } = useTranslation();
  const isHouse = isHouseType(form.propertyType);
  if (currentStep === 2) {
    return (
      <div className="lp-step">
        <StepHeader title={t('listProperty.steps.flatmateLocationTitle')} subtitle={t('listProperty.steps.flatmateLocationSubtitle')} onReset={onReset} />

        {/* Map first — the host pins the exact spot and we reverse-geocode it to
            pre-fill the address fields below, exactly as the whole-place flow does.
            Order matters: the address grid must come AFTER the pin, otherwise every
            field the host types first is marked hand-edited and auto-fill (which
            never clobbers a manual entry) has nothing left to fill. */}
        <div className="mb-6" data-err="location">
          <label className={`${lbl} mb-1`}>{t('listProperty.fields.pinFlatLocation')}</label>
          <p className="text-gray-500 text-xs mb-3">{t('listProperty.help.pinPropertyHint')}</p>
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
          <div style={{ height: 280, borderRadius: 14, overflow: 'hidden', border: `1px solid ${errors.location ? 'rgba(248,113,113,.6)' : 'rgba(255,255,255,.1)'}` }}>
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

        {/* Address — auto-filled from the pin where possible; the host confirms or
            completes anything we couldn't resolve. Mirrors the whole-place grid. */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>{t('listProperty.fields.locality')}</label>
            <LocalitySelect value={form.locality} onChange={(v) => onLocalityChange(v)} onSelect={(sel) => onLocalityChange(sel.name, sel)} placeholder={t('listProperty.ph.selectLocality')} options={localities} dataErr="locality" invalid={!!errors.locality} />
            <FieldError show={!!errors.locality}>{t('listProperty.err.locality')}</FieldError>
          </div>
          <div>
            <label className={lbl}>{isHouse ? t('listProperty.fields.houseBuildingName') : t('listProperty.fields.societyBuilding')}</label>
            {isHouse ? (
              <input autoComplete="organization" value={form.society} maxLength={60} onChange={(e) => set('society', cleanText(e.target.value))} data-err="society" placeholder={t('listProperty.ph.egGreenVilla')} className={`${fld} ${errors.society ? 'dz-invalid' : ''}`} />
            ) : (
              <SocietySelect value={form.societyId} name={form.society} localityLabel={form.locality} lat={form.propLat} lng={form.propLng} invalid={!!errors.society} onChange={({ id, name }) => { set('societyId', id); set('society', name); }} />
            )}
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

        {/* Flatmate pricing — the tenant's share, not the whole rent. */}
        <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>{t('listProperty.fields.yourShareRent')}</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
              <input inputMode="numeric" maxLength={10} {...money('rentShare')} data-err="rentShare" placeholder={t('listProperty.ph.egRentShare')} className={`${fld} pl-10 pr-14 ${errors.rentShare ? 'dz-invalid' : ''}`} />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMo')}</div>
            </div>
            <FieldError show={!!errors.rentShare}>{t('listProperty.err.rentShare')}</FieldError>
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.securityDeposit')}</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
              <input inputMode="numeric" maxLength={10} {...money('deposit')} placeholder={t('listProperty.ph.egDeposit28')} className={`${fld} pl-10 pr-4`} />
            </div>
          </div>
          <div>
            <label className={lbl}>{t('listProperty.fields.availableFrom')}</label>
            <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={fld} />
            <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableRoom')}</FieldError>
          </div>
        </div>

        <div className="flex justify-between lp-step-actions">
          <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
          <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">{t('listProperty.next')} <ArrowRight className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  // Step 3 — Photos & note
  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.flatmatePhotosTitle')} subtitle={t('listProperty.steps.flatmatePhotosSubtitle')} onReset={onReset} />

      <PhotoUploader
        form={form}
        photos={photos}
        handlePhotoUpload={handlePhotoUpload}
        removePhoto={removePhoto}
        setPhotoCategory={setPhotoCategory}
        error={errors.photos}
        label={t('listProperty.photoUploader.defaultLabel')}
        hint={t('listProperty.flatmate.photosHint')}
      />

      <div className="mb-8">
        <label className={lbl3}>{t('listProperty.fields.shortNote')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
        <textarea rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={t('listProperty.ph.notePlaceholder')} className={`${fld} resize-none`} />
      </div>

      <div className="flex justify-between lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <button onClick={submitFlatmate} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">
          <Users className="w-4 h-4" /> {t('listProperty.flatmate.postFind')}
        </button>
      </div>
    </div>
  );
};

export default FlatmateFlow;
