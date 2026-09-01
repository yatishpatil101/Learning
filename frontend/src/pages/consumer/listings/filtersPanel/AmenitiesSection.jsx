import { useTranslation } from 'react-i18next';
import MultiSelect from '../../../../components/ui/MultiSelect.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { optsOf } from './helpers.js';
import { AMEN_BUY, AMEN_RENT } from '../constants.js';

export default function AmenitiesSection({ f, set }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  if (!vis('amenities')) return null;
  return (
    <>
      <FilterGroup icon="sparkles" title={t('listings.amenities')} summary={f.amenities.size || f.pets ? t('listings.selectedCount', { count: f.amenities.size + (f.pets ? 1 : 0) }) : ''} defaultCollapsed>
        <MultiSelect
          values={[...f.amenities, ...(isRent && f.pets ? ['pet'] : [])]}
          onChange={(arr) => set({ amenities: new Set(arr.filter((v) => v !== 'pet')), ...(isRent ? { pets: arr.includes('pet') } : {}) })}
          options={optsOf(isRent ? [...AMEN_RENT, ['pet', t('listings.petFriendly')]] : AMEN_BUY)}
          placeholder={t('listings.anyAmenities')}
          ariaLabel={t('listings.amenities')}
          className="w-full"
          autoClose
        />
      </FilterGroup>
      <Divider />
    </>
  );
}
