import { MapPin, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import { FieldError } from './controls.jsx';
import LocationPicker from './LocationPicker.jsx';
import AreaSearch from './AreaSearch.jsx';
import StepHeader from './StepHeader.jsx';
import { fld, lbl } from './styles.js';
import { cleanText } from './sanitize.js';
import { localities } from './constants.js';
import { isIndustrial } from './validation.js';
import SocietySelect from './SocietySelect.jsx';

const LocationStep = ({
  form, set, errors, isLand, isCommercial, legacyAddress,
  mapSearch, onMapSearchChange, runMapSearch, mapSearchStatus, geoFillStatus, flyTo,
  onLocalityChange, onPinMove, locationSet, onAreaSelect,
  prevStep, nextStep, onReset,
}) => {
  const { t } = useTranslation();
  const land = isLand();
  const commercial = isCommercial();
  const addressOptional = isIndustrial(form);
  // Address terminology adapts to the property type: a shop isn't a "flat" and a
  // business park isn't a "society".
  const unitLabel = commercial
    ? t(addressOptional ? 'listProperty.fields.unitShopNo' : 'listProperty.fields.unitShopNoReq')
    : t('listProperty.fields.flatUnitNoReq');
  const unitPlaceholder = commercial ? t('listProperty.ph.egShopUnit') : t('listProperty.ph.egBUnit4');
  const blockLabel = commercial ? t('listProperty.fields.blockTower') : t('listProperty.fields.wingBlock');
  const blockPlaceholder = commercial ? t('listProperty.ph.egBTower') : t('listProperty.ph.egBWing');
  const projectLabel = land
    ? t('listProperty.fields.projectLayoutName')
    : commercial
      ? t(addressOptional ? 'listProperty.fields.buildingComplexName' : 'listProperty.fields.buildingComplexNameReq')
      : t('listProperty.fields.buildingSocietyNameReq');
  const projectPlaceholder = land ? t('listProperty.ph.egGreenAcres') : commercial ? t('listProperty.ph.egWtc') : t('listProperty.ph.egSkyline');
  const projectError = commercial ? t('listProperty.err.projectCommercial') : t('listProperty.err.society');

  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.locationTitle')} subtitle={t('listProperty.steps.locationSubtitle')} onReset={onReset} />

      {/* Locate first so the owner can confirm auto-filled details below. */}
      <div className="mb-6" data-err="location">
        <label className={`${lbl} mb-1`}>{t('listProperty.fields.pinPropertyLocation')}</label>
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
            <MapPin className="w-3 h-3 inline text-teal-400" /> {t('listProperty.help.searchOrDragProperty')}
          </p>
        )}
        {geoFillStatus === 'filling' && <p className="text-gray-500 text-xs mt-1.5">{t('listProperty.help.fillingAddress')}</p>}
        {geoFillStatus === 'done' && <p className="text-teal-300/80 text-xs mt-1.5 flex items-center gap-1.5"><MapPin className="w-3 h-3 text-teal-400" /> {t('listProperty.help.filledAddress')}</p>}
        <FieldError show={!!errors.location}>{t('listProperty.err.location')}</FieldError>
      </div>

      {legacyAddress && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className={`${lbl} mb-2`}>{t('listProperty.edit.savedAddress', { defaultValue: 'Saved address' })}</h3>
          <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{legacyAddress}</p>
          <p className="mt-2 text-xs text-gray-400">
            {land
              ? t('listProperty.edit.legacyLandAddress', { defaultValue: 'The separate address details were never saved. Leave them blank to keep this address, or fill in the details below to replace it.' })
              : t('listProperty.edit.legacyAddress', { defaultValue: 'The separate address details were never saved. Leave them blank to keep this address. To replace it, enter both the unit number and building/society name below; partial replacements cannot be saved.' })}
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Spans the row so the `sm:contents` pair below starts on a column boundary: with locality
            occupying one cell, unit and wing land either side of a row break and stop being a pair. */}
        <div className="sm:col-span-2"><label className={lbl}>{t('listProperty.fields.locality')}</label><LocalitySelect value={form.locality} onChange={(v) => onLocalityChange(v)} onSelect={(sel) => onLocalityChange(sel.name, sel)} placeholder={t('listProperty.ph.selectLocality')} options={localities} dataErr="locality" invalid={!!errors.locality} /><FieldError show={!!errors.locality}>{t('listProperty.err.locality')}</FieldError></div>
        {!land && (
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <div className="min-w-0"><label className={lbl}>{unitLabel}</label><input autoComplete="address-line2" value={form.flatNumber} maxLength={20} onChange={(e) => set('flatNumber', cleanText(e.target.value))} data-err="flatNumber" placeholder={unitPlaceholder} className={`${fld} ${errors.flatNumber ? 'dz-invalid' : ''}`} /><FieldError show={!!errors.flatNumber}>{commercial ? t('listProperty.err.unitShopNumber') : t('listProperty.err.flatNumber')}</FieldError></div>
            <div className="min-w-0"><label className={lbl}>{blockLabel}</label><input autoComplete="address-line2" value={form.tower} maxLength={30} onChange={(e) => set('tower', cleanText(e.target.value))} placeholder={blockPlaceholder} className={fld} /></div>
          </div>
        )}
        <div><label className={lbl}>{projectLabel}</label>{(!land && !commercial) ? (
          <SocietySelect value={form.societyId} name={form.society} localityLabel={form.locality} lat={form.propLat} lng={form.propLng} invalid={!!errors.society} placeholder={projectPlaceholder} onChange={({ id, name }) => { set('societyId', id); set('society', name); }} />
        ) : (
          <input autoComplete="organization" value={form.society} maxLength={60} onChange={(e) => set('society', cleanText(e.target.value))} data-err="society" placeholder={projectPlaceholder} className={`${fld} ${errors.society ? 'dz-invalid' : ''}`} />
        )}<FieldError show={!!errors.society}>{projectError}</FieldError></div>
        <div><label className={lbl}>{t('listProperty.fields.streetRoad')}</label><input autoComplete="address-line1" value={form.street} maxLength={60} onChange={(e) => set('street', cleanText(e.target.value))} placeholder={t('listProperty.ph.egBanerRoad')} className={fld} /></div>
        <div><label className={lbl}>{t('listProperty.fields.landmark')}</label><input autoComplete="address-line3" value={form.landmark} maxLength={60} onChange={(e) => set('landmark', cleanText(e.target.value))} placeholder={t('listProperty.ph.egDMart')} className={fld} /></div>
        <div><label className={lbl}>{t('listProperty.fields.pincodeReq')}</label><input autoComplete="postal-code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} data-err="pincode" placeholder="411045" className={`${fld} ${errors.pincode ? 'dz-invalid' : ''}`} /><FieldError show={!!errors.pincode}>{t('listProperty.err.pincode')}</FieldError></div>
      </div>

      <div className="flex justify-between lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">{t('listProperty.next')} <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

export default LocationStep;
