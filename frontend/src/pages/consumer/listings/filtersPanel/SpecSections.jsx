import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import { FilterGroup, Divider, Cb, Rb } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { RANGE } from '../../../../lib/listings/filterState.js';
import { tLabel } from './helpers.js';
import { BHK_BUY, BHK_RENT, AVAIL_BUY, FURN } from '../constants.js';

const [AREA_MIN, AREA_MAX] = RANGE.area;

export default function SpecSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  return (
    <>
      {vis('bhk') && (
        <>
          <FilterGroup icon="bed-double" title={isRent ? t('listings.bhkRoomType') : t('listings.bhkType')} summary={tLabel(isRent ? BHK_RENT : BHK_BUY, f.bhk)}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {(isRent ? BHK_RENT : BHK_BUY).map(([v, label]) => (
                <Cb key={v} id={`${idp}bhk-${v}`} label={label} checked={f.bhk.has(v)} onChange={() => set({ bhk: toggleSet(f.bhk, v) })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {!isRent && vis('availability') && (
        <>
          <FilterGroup icon="calendar-check" title={t('listings.availability')} summary={(AVAIL_BUY.find(([v]) => v === f.avail) || [])[1] === 'All' ? '' : (AVAIL_BUY.find(([v]) => v === f.avail) || [])[1]}>
            <div className="space-y-3">
              {AVAIL_BUY.map(([v, label]) => (
                <Rb key={v || 'all'} id={`${idp}av-${v || 'all'}`} name={`${idp}availability`} label={label} checked={f.avail === v} onChange={() => set({ avail: v })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('furnishing') && (
        <>
          <FilterGroup icon="sofa" title={t('listings.furnishing')} summary={tLabel(FURN, f.furnishing)}>
            <div className="space-y-3">
              {FURN.map(([k, label]) => (
                <Cb key={k} id={`${idp}furn-${k}`} label={label} checked={f.furnishing.has(k)} onChange={() => set({ furnishing: toggleSet(f.furnishing, k) })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      <FilterGroup icon="ruler" title={t('listings.carpetArea')} summary={f.area[0] === AREA_MIN && f.area[1] === AREA_MAX ? '' : `${f.area[0]} - ${f.area[1]}`} defaultCollapsed>
        <DualRange min={AREA_MIN} max={AREA_MAX} step={50} value={f.area} onChange={(v) => set({ area: v })} label={t('listings.carpetAreaLabel')} format={(v) => v.toLocaleString('en-IN')} />
      </FilterGroup>
      <Divider />
    </>
  );
}
