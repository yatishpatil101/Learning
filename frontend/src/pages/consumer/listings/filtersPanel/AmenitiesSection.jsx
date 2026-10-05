import { useTranslation } from 'react-i18next';
import { FilterGroup, Divider, CbGrid } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { AMEN_BUY, AMEN_RENT } from '../constants.js';

export default function AmenitiesSection({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  if (!sectionVisible('amenities', f.types)) return null;
  const options = isRent ? [...AMEN_RENT, ['pet', t('listings.petFriendly')]] : AMEN_BUY;
  const selected = new Set([...f.amenities, ...(isRent && f.pets ? ['pet'] : [])]);
  const toggle = (v) => set((p) => (v === 'pet' ? { pets: !p.pets } : { amenities: toggleSet(p.amenities, v) }));
  return (
    <>
      <FilterGroup icon="sparkles" title={t('listings.amenities')} summary={selected.size ? t('listings.selectedCount', { count: selected.size }) : ''} defaultCollapsed>
        <CbGrid idp={idp} name="amen" options={options} selected={selected} onToggle={toggle} />
      </FilterGroup>
      <Divider />
    </>
  );
}
