import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import Field from '../../../../components/ui/Field.jsx';
import { AREA_UNITS, PROPERTY_ATTRIBUTE_KINDS, PUNE_POLICE_STATIONS, PUNE_TALUKAS } from './constants.js';

const FIELD = 'field w-full px-4 py-3 rounded-xl text-white text-sm';
const emptyAttribute = () => ({ kind: 'CTS No.', number: '' });

export const propertyAttributesOf = (prop = {}) => {
  if (Array.isArray(prop.propertyAttributes)) return prop.propertyAttributes;
  return prop.surveyNo ? [{ kind: 'Survey No.', number: prop.surveyNo }] : [];
};

export default function IgrPropertyFields({ t, prop, setP, setProp, errors = {}, clearErr, clearPropertyBinding }) {
  const attributes = propertyAttributesOf(prop);
  const saveAttributes = (next) => {
    setProp((p) => ({ ...p, propertyAttributes: next }));
    clearErr('propertyAttributes');
  };
  const setAttribute = (i, key, value) => {
    saveAttributes(attributes.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
    clearErr(`pa${i}${key}`);
  };
  const setBound = (key, value) => {
    clearPropertyBinding();
    setP(key, value);
    clearErr(key);
  };
  const areaClass = FIELD + (errors.galleryArea ? ' err' : '');

  return (
    <section className="space-y-5 mb-5" data-testid="ra-igr-property">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('services.ra.property.taluka')} required error={errors.taluka && t('services.ra.property.talukaErr')}>
          <NativeSelect value={prop.taluka} title={t('services.ra.property.taluka')} onChange={(e) => setBound('taluka', e.target.value)} invalid={!!errors.taluka}>
            <option value="">{t('services.ra.property.talukaPlaceholder')}</option>
            {PUNE_TALUKAS.map((name) => <option key={name} value={name}>{name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t('services.ra.property.villageCity')} required error={errors.villageCity && t('services.ra.property.villageCityErr')}>
          <input value={prop.villageCity || ''} maxLength={80} onChange={(e) => setBound('villageCity', e.target.value)} className={(FIELD + (errors.villageCity ? ' err' : ''))} placeholder={t('services.ra.property.villageCityPlaceholder')} />
        </Field>
        <Field label={t('services.ra.property.roadName')}>
          <input value={prop.roadName || ''} maxLength={120} onChange={(e) => setBound('roadName', e.target.value)} className={FIELD} placeholder={t('services.ra.property.roadNamePlaceholder')} />
        </Field>
        <Field label={t('services.ra.property.policeStation')}>
          <input value={prop.policeStation || ''} maxLength={80} list="ra-police-stations" onChange={(e) => setBound('policeStation', e.target.value)} className={FIELD} placeholder={t('services.ra.property.policeStationPlaceholder')} />
          <datalist id="ra-police-stations">{PUNE_POLICE_STATIONS.map((name) => <option key={name} value={name} />)}</datalist>
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="lbl mb-0">{t('services.ra.property.attributes')}</p>
            <p className="text-gray-500 text-xs">{t('services.ra.property.attributesHint')}</p>
          </div>
          <button type="button" onClick={() => saveAttributes([...attributes, emptyAttribute()])} className="btn-outline px-3 py-2 rounded-xl text-teal-400 text-xs font-semibold flex items-center gap-2"><Icon name="plus-circle" className="w-4 h-4" /> {t('services.ra.property.attributeAdd')}</button>
        </div>
        <div className="space-y-2">
          {attributes.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-xl border border-white/10 p-2" data-testid={`ra-property-attribute-${i}`}>
              <Field label={t('services.ra.property.attributeKind')} required error={errors[`pa${i}kind`] && t('services.ra.property.attributeKindErr')}>
                <NativeSelect value={row.kind || ''} title={t('services.ra.property.attributeKind')} onChange={(e) => setAttribute(i, 'kind', e.target.value)} invalid={!!errors[`pa${i}kind`]}>
                  {PROPERTY_ATTRIBUTE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t('services.ra.property.attributeNumber')} required error={errors[`pa${i}number`] && t('services.ra.property.attributeNumberErr')}>
                <input value={row.number || ''} maxLength={80} onChange={(e) => setAttribute(i, 'number', e.target.value)} className={FIELD + (errors[`pa${i}number`] ? ' err' : '')} placeholder={t('services.ra.property.attributeNumberPlaceholder')} />
              </Field>
              <button type="button" onClick={() => saveAttributes(attributes.filter((_, idx) => idx !== i))} className="self-end p-3 rounded-xl text-gray-400 hover:text-red-400" title={t('services.ra.tenant.remove')} aria-label={t('services.ra.tenant.remove')}><Icon name="x" className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <FieldError alert={false} show={!!errors.propertyAttributes}>{t('services.ra.property.attributesErr')}</FieldError>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 max-w-[640px]">
        <Field label={t('services.ra.property.galleryArea')} error={errors.galleryArea && t('services.ra.property.optionalAreaErr')}>
          <input inputMode="decimal" value={prop.galleryArea || ''} onChange={(e) => { setP('galleryArea', e.target.value.replace(/[^\d.]/g, '')); clearErr('galleryArea'); }} className={areaClass} placeholder={t('services.ra.property.smallAreaPlaceholder')} />
        </Field>
        <Field label={t('services.ra.property.areaUnit')}>
          <NativeSelect value={prop.galleryAreaUnit || 'sqft'} title={t('services.ra.property.galleryAreaUnit')} onChange={(e) => setP('galleryAreaUnit', e.target.value)}>
            {AREA_UNITS.map((v) => <option key={v} value={v}>{t(`services.ra.property.areaUnitOpt.${v}`)}</option>)}
          </NativeSelect>
        </Field>
      </div>
    </section>
  );
}
