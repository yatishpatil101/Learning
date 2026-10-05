import { useTranslation } from 'react-i18next';
import { FilterGroup, Divider, CbGrid } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { areaProfileForTypes, defaultAreaRangeSqft } from '../../../../lib/listings/areaUnits.js';
import { tLabel } from './helpers.js';
import { BUY_TYPES, RENT_TYPES, COMMERCIAL_TYPES, LAND_USE, ROOM_TYPES } from '../constants.js';
import { NA_STATUS } from './facetOptions.js';

const ChipButton = ({ active, children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-11 rounded-xl border px-3 text-sm font-semibold text-left t-all ${active ? 'border-teal-300 bg-teal-400/15 text-teal-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}
  >
    {children}
  </button>
);

export default function PropertyTypeSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  const toggleType = (v) => set((prev) => {
    const types = toggleSet(prev.types, v);
    const next = prev.types.has('commercial') && !types.has('commercial') ? { types, commercialTypes: new Set() } : { types };
    const nextProfile = areaProfileForTypes(types, prev.areaUnit);
    next.area = defaultAreaRangeSqft(nextProfile);
    next.areaUnit = nextProfile.unit;
    return next;
  });
  const naOptions = NA_STATUS.map(([v, key]) => [v, t(key)]);
  return (
    <>
      <FilterGroup icon="building-2" title={t('listings.propertyType')} summary={tLabel(isRent ? RENT_TYPES : BUY_TYPES, f.types)}>
        <CbGrid idp={idp} name="type" options={isRent ? RENT_TYPES : BUY_TYPES} selected={f.types} onToggle={toggleType} />
      </FilterGroup>
      <Divider />

      {f.types.has('commercial') ? (
        <>
          <FilterGroup icon="briefcase" title={t('listings.commercialType')} summary={tLabel(COMMERCIAL_TYPES, f.commercialTypes)}>
            <CbGrid idp={idp} name="ctype" options={COMMERCIAL_TYPES} selected={f.commercialTypes} onToggle={(v) => set((p) => ({ commercialTypes: toggleSet(p.commercialTypes, v) }))} />
          </FilterGroup>
          <Divider />
        </>
      ) : null}

      {vis('landUse') && (
        <>
          <FilterGroup icon="map" title={t('listings.landUse')} summary={tLabel(LAND_USE, f.landUse)}>
            <CbGrid idp={idp} name="landuse" options={LAND_USE} selected={f.landUse} onToggle={(v) => set((p) => ({ landUse: toggleSet(p.landUse, v) }))} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('na') && (
        <>
          <FilterGroup icon="landmark" title={t('listings.naStatus')} summary={tLabel(naOptions, f.na)}>
            <div className="grid grid-cols-2 gap-2">
              {naOptions.map(([k, label]) => (
                <ChipButton key={k} active={f.na.has(k)} onClick={() => set((p) => ({ na: toggleSet(p.na, k) }))}>{label}</ChipButton>
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('room') && (
        <>
          <FilterGroup icon="door-open" title={t('listings.roomType')} summary={tLabel(ROOM_TYPES, f.room)}>
            <CbGrid idp={idp} name="room" options={ROOM_TYPES} selected={f.room} onToggle={(v) => set((p) => ({ room: toggleSet(p.room, v) }))} />
          </FilterGroup>
          <Divider />
        </>
      )}
    </>
  );
}
