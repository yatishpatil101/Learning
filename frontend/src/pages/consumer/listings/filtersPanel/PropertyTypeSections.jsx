import { useTranslation } from 'react-i18next';
import MultiSelect from '../../../../components/ui/MultiSelect.jsx';
import { FilterGroup, Divider, Cb } from '../FilterControls.jsx';
import { toggleSet } from '../matchers.js';
import { sectionVisible } from '../../../../lib/listings/filterRelevance.js';
import { tLabel, optsOf } from './helpers.js';
import { BUY_TYPES, RENT_TYPES, COMMERCIAL_TYPES, LAND_USE, ROOM_TYPES, PG_SHARING } from '../constants.js';

export default function PropertyTypeSections({ f, set, idp }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  const vis = (section) => sectionVisible(section, f.types);
  return (
    <>
      <FilterGroup icon="building-2" title={t('listings.propertyType')} summary={tLabel(isRent ? RENT_TYPES : BUY_TYPES, f.types)}>
        <MultiSelect
          values={[...f.types]}
          onChange={(arr) => set(f.types.has('commercial') && !arr.includes('commercial') ? { types: new Set(arr), commercialTypes: new Set() } : { types: new Set(arr) })}
          options={optsOf(isRent ? RENT_TYPES : BUY_TYPES)}
          placeholder={t('listings.anyType')}
          ariaLabel={t('listings.propertyType')}
          className="w-full"
          autoClose
        />
      </FilterGroup>
      <Divider />

      {f.types.has('commercial') ? (
        <>
          <FilterGroup icon="briefcase" title={t('listings.commercialType')} summary={tLabel(COMMERCIAL_TYPES, f.commercialTypes)}>
            <MultiSelect
              values={[...f.commercialTypes]}
              onChange={(arr) => set({ commercialTypes: new Set(arr) })}
              options={optsOf(COMMERCIAL_TYPES)}
              placeholder={t('listings.anyCommercialType')}
              ariaLabel={t('listings.commercialType')}
              className="w-full"
              autoClose
            />
          </FilterGroup>
          <Divider />
        </>
      ) : null}

      {vis('landUse') && (
        <>
          <FilterGroup icon="map" title={t('listings.landUse')} summary={tLabel(LAND_USE, f.landUse)}>
            <MultiSelect
              values={[...f.landUse]}
              onChange={(arr) => set({ landUse: new Set(arr) })}
              options={optsOf(LAND_USE)}
              placeholder={t('listings.anyZone')}
              ariaLabel={t('listings.landUse')}
              className="w-full"
              autoClose
            />
          </FilterGroup>
          <Divider />
        </>
      )}

      {isRent && f.types.has('flatmates') ? (
        <>
          <FilterGroup icon="door-open" title={t('listings.roomType')} summary={tLabel(ROOM_TYPES, f.room)}>
            <div className="space-y-3">
              {ROOM_TYPES.map(([k, label]) => (
                <Cb key={k} id={`${idp}room-${k}`} label={label} checked={f.room.has(k)} onChange={() => set({ room: toggleSet(f.room, k) })} />
              ))}
            </div>
          </FilterGroup>
          <Divider />
        </>
      ) : null}

      {f.types.has('pg') ? (
        <>
          <FilterGroup icon="bed-double" title={t('listings.sharing')} summary={tLabel(PG_SHARING, f.sharing)}>
            <MultiSelect
              values={[...f.sharing]}
              onChange={(arr) => set({ sharing: new Set(arr) })}
              options={optsOf(PG_SHARING)}
              placeholder={t('listings.anySharing')}
              ariaLabel={t('listings.sharing')}
              className="w-full"
              autoClose
            />
          </FilterGroup>
          <Divider />
        </>
      ) : null}
    </>
  );
}
