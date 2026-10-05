import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import { FilterGroup, Divider, Rb, CbGrid } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { RANGE } from '../../../../lib/listings/filterState.js';
import { fmtRent } from '../format.js';
import { tLabel } from './helpers.js';
import { AVAIL_FROM, TENANTS } from '../constants.js';
import { FOOD } from './facetOptions.js';

const [DEP_MIN, DEP_MAX] = RANGE.deposit;

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

export function TenantsSection({ f, set, idp }) {
  const { t } = useTranslation();
  if (!sectionVisible('tenants', f.types)) return null;
  return (
    <>
      <FilterGroup icon="users" title={t('listings.preferredTenants')} summary={tLabel(TENANTS, f.tenants)}>
        <CbGrid idp={idp} name="tenant" options={TENANTS} selected={f.tenants} onToggle={(v) => set((p) => ({ tenants: toggleSet(p.tenants, v) }))} />
      </FilterGroup>
      <Divider />
    </>
  );
}

export function AvailFromSection({ f, set, idp }) {
  const { t } = useTranslation();
  if (!sectionVisible('availFrom', f.types)) return null;
  const label = (AVAIL_FROM.find(([v]) => v === f.availFrom) || [])[1];
  return (
    <>
      <FilterGroup icon="calendar-check" title={t('listings.availableFrom')} summary={label === 'Anytime' ? '' : label}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          {AVAIL_FROM.map(([v, optLabel]) => (
            <Rb key={v || 'any'} id={`${idp}avf-${v || 'any'}`} name={`${idp}rentAvail`} label={optLabel} checked={f.availFrom === v} onChange={() => set({ availFrom: v })} />
          ))}
        </div>
      </FilterGroup>
      <Divider />
    </>
  );
}

export default function RentExtraSections({ f, set }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  if (!isRent) return null;
  const foodOptions = FOOD.map(([v, key]) => [v, t(key)]);
  return (
    <>
      <FilterGroup icon="wallet" title={t('listings.securityDeposit')} summary={f.deposit[0] === DEP_MIN && f.deposit[1] === DEP_MAX ? '' : `${fmtRent(f.deposit[0])} - ${fmtRent(f.deposit[1])}`}>
        <DualRange min={DEP_MIN} max={DEP_MAX} step={10000} value={f.deposit} onChange={(v) => set({ deposit: v })} label={t('listings.securityDeposit')} format={(v) => (v === DEP_MAX ? `${fmtRent(v)}+` : fmtRent(v))} />
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

      {vis('food') && (
        <>
          <FilterGroup icon="utensils" title={t('listings.foodPreference')} summary={tLabel(foodOptions, new Set(f.food ? [f.food] : []))} defaultCollapsed>
            <div className="grid grid-cols-2 gap-2">
              {foodOptions.map(([v, label]) => (
                <ChipButton key={v} active={f.food === v} onClick={() => set((p) => ({ food: p.food === v ? '' : v }))}>{label}</ChipButton>
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      )}
    </>
  );
}
