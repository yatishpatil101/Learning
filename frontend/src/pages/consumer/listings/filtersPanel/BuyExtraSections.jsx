import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import { FilterGroup, Divider, Cb } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { tLabel } from './helpers.js';
import { CONSTR_STATUS } from '../constants.js';

export default function BuyExtraSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  if (isRent) return null;
  return (
    <>
      <FilterGroup icon="ruler" title={t('listings.carpetArea')} summary={f.area[0] === 0 && f.area[1] === 6000 ? '' : `${f.area[0]} - ${f.area[1]}`} defaultCollapsed>
        <DualRange min={0} max={6000} step={50} value={f.area} onChange={(v) => set({ area: v })} label={t('listings.carpetAreaLabel')} format={(v) => v.toLocaleString('en-IN')} />
      </FilterGroup>
      <Divider />

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

      {vis('construction') && (
        <>
          <FilterGroup icon="hard-hat" title={t('listings.constructionStatus')} summary={tLabel(CONSTR_STATUS, f.constr)} defaultCollapsed>
            <div className="space-y-3">
              {CONSTR_STATUS.map(([k, label]) => (
                <Cb key={k} id={`${idp}constr-${k}`} label={label} checked={f.constr.has(k)} onChange={() => set({ constr: toggleSet(f.constr, k) })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}
    </>
  );
}
