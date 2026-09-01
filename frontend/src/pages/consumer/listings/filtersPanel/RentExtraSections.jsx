import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import MultiSelect from '../../../../components/ui/MultiSelect.jsx';
import { FilterGroup, Divider, Rb } from '../FilterControls.jsx';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { tLabel, optsOf } from './helpers.js';
import { AVAIL_FROM, TENANTS } from '../constants.js';

export default function RentExtraSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  if (!isRent) return null;
  return (
    <>
      {vis('availFrom') && (
        <>
          <FilterGroup icon="calendar-check" title={t('listings.availableFrom')} summary={(AVAIL_FROM.find(([v]) => v === f.availFrom) || [])[1] === 'Anytime' ? '' : (AVAIL_FROM.find(([v]) => v === f.availFrom) || [])[1]}>
            <div className="space-y-3">
              {AVAIL_FROM.map(([v, label]) => (
                <Rb key={v || 'any'} id={`${idp}avf-${v || 'any'}`} name={`${idp}rentAvail`} label={label} checked={f.availFrom === v} onChange={() => set({ availFrom: v })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('age') && (
        <>
          <FilterGroup icon="calendar-clock" title={t('listings.propertyAge')} summary={f.age[0] === 0 && f.age[1] === 25 ? '' : `${f.age[0]} - ${f.age[1] === 25 ? '25+' : f.age[1]} ${t('listings.yr')}`} defaultCollapsed>
            <DualRange min={0} max={25} step={1} value={f.age} onChange={(v) => set({ age: v })} label={t('listings.propertyAge')} format={(v) => (v === 0 ? t('listings.ageNew') : `${v}${v === 25 ? '+' : ''} ${t('listings.yr')}`)} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('floor') && (
        <>
          <FilterGroup icon="building" title={t('listings.floorNumber')} summary={f.floor[0] === 0 && f.floor[1] === 40 ? '' : `${f.floor[0] === 0 ? t('listings.groundShort') : f.floor[0]} - ${f.floor[1] === 40 ? '40+' : f.floor[1]}`} defaultCollapsed>
            <DualRange min={0} max={40} step={1} value={f.floor} onChange={(v) => set({ floor: v })} label={t('listings.floorNumber')} format={(v) => (v === 0 ? t('listings.ground') : `${v}${v === 40 ? '+' : ''}`)} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('tenants') && (
        <>
          <FilterGroup icon="users" title={t('listings.preferredTenants')} summary={tLabel(TENANTS, f.tenants)} defaultCollapsed>
            <MultiSelect
              values={[...f.tenants]}
              onChange={(arr) => set({ tenants: new Set(arr) })}
              options={optsOf(TENANTS)}
              placeholder={t('listings.anyTenants')}
              ariaLabel={t('listings.preferredTenants')}
              className="w-full"
              autoClose
            />
          </FilterGroup>
          <Divider />
        </>
      )}
    </>
  );
}
