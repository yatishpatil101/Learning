import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';

export default function StepProperty({ step, aType, setAType, prop, setP, setProp, setShowPropertyPicker, myProperties = [], errors = {}, fc, clearErr }) {
  const { t } = useTranslation();
  const typeLabel = { Residential: t('services.ra.property.typeResidential'), Commercial: t('services.ra.property.typeCommercial') };
  return (
    <div className={'step-panel' + (step === 0 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{t('services.ra.property.title')}</h2>
      <p className="text-gray-500 text-sm mb-6">{t('services.ra.property.subtitle')}</p>

      {/* Property picker for owners with existing listings. The rows arrive as a prop rather than
          from a `getListings()` call in this render: that read hit localStorage, so against the API
          the picker never appeared for anybody, and being inline it re-read on every keystroke. */}
      {(() => {
        const myListings = myProperties.filter((l) => l.deal === 'rent' || l.deal === 'buy');
        if (!myListings.length) return null;
        return (
          <div className="mb-6 p-4 rounded-xl border border-teal-400/20 bg-teal-400/5">
            <p className="text-sm font-medium text-white mb-2">{t('services.ra.property.pickerQuestion')}</p>
            <div className="space-y-2 mb-3">
              {myListings.slice(0, 3).map((l) => (
                <button key={l.id} type="button" onClick={() => { setProp((p) => ({ ...p, flatNo: l.form?.flatNumber || '', society: l.society || l.form?.society || '', locality: l.locality || l.form?.locality || '', pincode: l.form?.pincode || p.pincode, area: String(l.area || l.form?.carpetArea || '') })); setShowPropertyPicker(false); }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:border-teal-400/30 text-left transition">
                  <Icon name="building-2" className="w-4 h-4 text-teal-400 flex-shrink-0" />
                  <span className="text-sm text-gray-300 truncate">{l.title || `${l.bhk} ${l.type}`} — {l.locality || 'Pune'}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowPropertyPicker(false)} className="text-xs text-gray-500 hover:text-teal-400">{t('services.ra.property.enterManually')}</button>
          </div>
        );
      })()}

      <label className="lbl">{t('services.ra.property.agreementType')}</label>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {['Residential', 'Commercial'].map((v) => (
          <div key={v} onClick={() => setAType(v)} className={'opt-pill rounded-xl px-4 py-3 text-sm font-medium text-center ' + (aType === v ? 'sel' : 'text-gray-400')}>{typeLabel[v]}</div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5">
        <div>
          <label className="lbl">{t('services.ra.property.propertyType')}</label>
          <NativeSelect value={prop.propType} onChange={(e) => setP('propType', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">
            {['Flat / Apartment', 'Independent House / Bungalow', 'Row House', 'Shop', 'Office', 'Godown / Warehouse'].map((o) => <option key={o}>{o}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label className="lbl">{t('services.ra.property.furnishing')}</label>
          <NativeSelect value={prop.furnish} onChange={(e) => setP('furnish', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">
            {['Unfurnished', 'Semi-Furnished', 'Furnished'].map((o) => <option key={o}>{o}</option>)}
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div><label className="lbl req">{t('services.ra.property.flatNo')}</label><input value={prop.flatNo} onChange={(e) => { setP('flatNo', e.target.value); clearErr('flatNo'); }} className={fc('flatNo')} placeholder={t('services.ra.property.flatNoPlaceholder')} /><FieldError show={!!errors.flatNo}>{t('services.ra.property.flatNoErr')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.property.society')}</label><input value={prop.society} onChange={(e) => { setP('society', e.target.value); clearErr('society'); }} className={fc('society')} placeholder={t('services.ra.property.societyPlaceholder')} /><FieldError show={!!errors.society}>{t('services.ra.property.societyErr')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.property.locality')}</label><input value={prop.locality} onChange={(e) => { setP('locality', e.target.value); clearErr('locality'); }} className={fc('locality')} placeholder={t('services.ra.property.localityPlaceholder')} /><FieldError show={!!errors.locality}>{t('services.ra.property.localityErr')}</FieldError></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">{t('services.ra.property.city')}</label><input value={prop.city} onChange={(e) => setP('city', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
          <div><label className="lbl req">{t('services.ra.property.pincode')}</label><input inputMode="numeric" maxLength={6} value={prop.pincode} onChange={(e) => { setP('pincode', e.target.value.replace(/\D/g, '')); clearErr('pincode'); }} className={fc('pincode')} placeholder={t('services.ra.property.pincodePlaceholder')} /><FieldError show={!!errors.pincode}>{t('services.ra.property.pincodeErr')}</FieldError></div>
        </div>
      </div>
      <div><label className="lbl">{t('services.ra.property.builtUpArea')}</label><input inputMode="numeric" value={prop.area} onChange={(e) => setP('area', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.property.areaPlaceholder')} /></div>
    </div>
  );
}
