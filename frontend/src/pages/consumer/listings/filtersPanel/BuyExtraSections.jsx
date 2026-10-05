import { useTranslation } from 'react-i18next';
import DualRange from '../../../../components/ui/DualRange.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';

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

export default function BuyExtraSections({ f, set }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  if (isRent) return null;
  return (
    <>
      {vis('age') && (
        <>
          <FilterGroup icon="calendar-clock" title={t('listings.propertyAge')} summary={f.age[0] === 0 && f.age[1] === 25 ? '' : `${f.age[0]} - ${f.age[1] === 25 ? '25+' : f.age[1]} ${t('listings.yr')}`} defaultCollapsed>
            <DualRange min={0} max={25} step={1} value={f.age} onChange={(v) => set({ age: v })} label={t('listings.propertyAge')} format={(v) => (v === 0 ? t('listings.ageNew') : `${v}${v === 25 ? '+' : ''} ${t('listings.yr')}`)} />
          </FilterGroup>
          <Divider />
        </>
      )}

      {vis('preLeased') && (
        <>
          <FilterGroup icon="landmark" title={t('listings.investment')} summary={f.preLeased ? t('listings.preLeased') : ''} defaultCollapsed>
            <ChipButton active={f.preLeased} onClick={() => set({ preLeased: !f.preLeased })}>{t('listings.preLeased')}</ChipButton>
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
    </>
  );
}
