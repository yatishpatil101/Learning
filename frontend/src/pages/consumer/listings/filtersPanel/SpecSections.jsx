import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import { FilterGroup, Divider, CbGrid } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { areaProfileForTypes, defaultAreaRangeSqft, displayAreaRange, formatAreaRange, formatAreaValue, isDefaultAreaRange, toSqft, unitLabel } from '../../../../lib/listings/areaUnits.js';
import { tLabel } from './helpers.js';
import { BHK_BUY, BHK_RENT, CONSTR_STATUS, FURN } from '../constants.js';
import { BATHS, FACING, SHELL } from './facetOptions.js';

const ChipButton = ({ active, children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-11 rounded-xl border px-3 text-sm font-semibold t-all ${active ? 'border-teal-300 bg-teal-400/15 text-teal-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}
  >
    {children}
  </button>
);

export function BhkSection({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  if (!sectionVisible('bhk', f.types)) return null;
  const opts = isRent ? BHK_RENT : BHK_BUY;
  return (
    <>
      <FilterGroup icon="bed-double" title={isRent ? t('listings.bhkRoomType') : t('listings.bhkType')} summary={tLabel(opts, f.bhk)}>
        <CbGrid idp={idp} name="bhk" options={opts} selected={f.bhk} onToggle={(v) => set((p) => ({ bhk: toggleSet(p.bhk, v) }))} />
      </FilterGroup>
      <Divider />
    </>
  );
}

export function FurnishingSection({ f, set, idp }) {
  const { t } = useTranslation();
  if (!sectionVisible('furnishing', f.types)) return null;
  return (
    <>
      <FilterGroup icon="sofa" title={t('listings.furnishing')} summary={tLabel(FURN, f.furnishing)}>
        <CbGrid idp={idp} name="furn" options={FURN} selected={f.furnishing} onToggle={(v) => set((p) => ({ furnishing: toggleSet(p.furnishing, v) }))} />
      </FilterGroup>
      <Divider />
    </>
  );
}

export default function SpecSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  const areaProfile = useMemo(() => areaProfileForTypes(f.types, f.areaUnit), [f.types, f.areaUnit]);
  const areaValue = useMemo(() => displayAreaRange(f.area, areaProfile), [f.area, areaProfile]);
  const areaTitle = areaProfile.kind === 'built' ? t('listings.carpetArea') : t('listings.landArea');
  const areaLabel = areaProfile.kind === 'built' ? t('listings.carpetAreaLabel') : t('listings.landArea');
  const facingOptions = FACING.map(([v, key]) => [v, t(key)]);
  const bathOptions = BATHS.map(([v, key]) => [v, t(key)]);
  const shellOptions = SHELL.map(([v, key]) => [v, t(key)]);
  return (
    <>
      {!isRent && <BhkSection f={f} set={set} idp={idp} />}

      {vis('facing') && (
        <>
          <FilterGroup icon="compass" title={t('listings.facing')} summary={tLabel(facingOptions, f.facing)} defaultCollapsed>
            <CbGrid idp={idp} name="facing" options={facingOptions} selected={f.facing} onToggle={(v) => set((p) => ({ facing: toggleSet(p.facing, v) }))} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('baths') && (
        <>
          <FilterGroup icon="shower-head" title={t('listings.bathrooms')} summary={tLabel(bathOptions, new Set(f.minBaths ? [f.minBaths] : []))} defaultCollapsed>
            <div className="grid grid-cols-2 gap-2">
              {bathOptions.map(([v, label]) => (
                <ChipButton key={v} active={f.minBaths === v} onClick={() => set({ minBaths: f.minBaths === v ? '' : v })}>{label}</ChipButton>
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {!isRent && vis('construction') && (
        <>
          <FilterGroup icon="calendar-check" title={t('listings.availability')} summary={tLabel(CONSTR_STATUS, f.constr)}>
            <CbGrid idp={idp} name="possession" options={CONSTR_STATUS} selected={f.constr} onToggle={(v) => set((p) => ({ constr: toggleSet(p.constr, v) }))} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {!isRent && <FurnishingSection f={f} set={set} idp={idp} />}

      {vis('shell') && (
        <>
          <FilterGroup icon="briefcase" title={t('listings.fitOut')} summary={tLabel(shellOptions, f.shell)} defaultCollapsed>
            <div className="grid grid-cols-2 gap-2">
              {shellOptions.map(([v, label]) => (
                <ChipButton key={v} active={f.shell.has(v)} onClick={() => set((p) => ({ shell: toggleSet(p.shell, v) }))}>{label}</ChipButton>
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('area') && (
        <>
          <FilterGroup icon="ruler" title={areaTitle} summary={isDefaultAreaRange(f.area, areaProfile) ? '' : formatAreaRange(f.area, areaProfile)} defaultCollapsed>
            {areaProfile.units.length > 1 ? (
              <div className="mb-3 grid grid-cols-2 gap-2">
                {areaProfile.units.map((unit) => {
                  const nextProfile = areaProfileForTypes(f.types, unit);
                  return (
                    <ChipButton key={unit} active={areaProfile.unit === unit} onClick={() => set({ areaUnit: unit, area: defaultAreaRangeSqft(nextProfile) })}>
                      {unitLabel(unit)}
                    </ChipButton>
                  );
                })}
              </div>
            ) : null}
            <DualRange
              min={areaProfile.min}
              max={areaProfile.max}
              step={areaProfile.step}
              value={areaValue}
              onChange={(v) => set({ area: [toSqft(v[0], areaProfile.unit), toSqft(v[1], areaProfile.unit)], areaUnit: areaProfile.unit })}
              label={areaLabel}
              format={(v) => formatAreaValue(v, areaProfile.unit)}
            />
          </FilterGroup>
          <Divider />
        </>
      )}
    </>
  );
}
