import { useTranslation } from 'react-i18next';
import BudgetSection from './filtersPanel/BudgetSection.jsx';
import LocalitySection from './filtersPanel/LocalitySection.jsx';
import NearAPlaceSection from './filtersPanel/NearAPlaceSection.jsx';
import PropertyTypeSections from './filtersPanel/PropertyTypeSections.jsx';
import SpecSections, { BhkSection, FurnishingSection } from './filtersPanel/SpecSections.jsx';
import RentExtraSections, { TenantsSection, AvailFromSection } from './filtersPanel/RentExtraSections.jsx';
import BuyExtraSections from './filtersPanel/BuyExtraSections.jsx';
import AmenitiesSection from './filtersPanel/AmenitiesSection.jsx';
import VerificationSection from './filtersPanel/VerificationSection.jsx';

export default function Filters({ f, set, localities, onAddLocality, clearAll, idp = '', showClear = true }) {
  const { t } = useTranslation();
  const isRent = f.deal === 'rent';
  return (
    <div className="space-y-3.5">
      <BudgetSection f={f} set={set} />
      <LocalitySection f={f} set={set} localities={localities} onAddLocality={onAddLocality} />
      {isRent ? <PropertyTypeSections f={f} set={set} idp={idp} /> : null}
      {isRent ? (
        <>
          <TenantsSection f={f} set={set} idp={idp} />
          <BhkSection f={f} set={set} idp={idp} />
          <FurnishingSection f={f} set={set} idp={idp} />
          <AvailFromSection f={f} set={set} idp={idp} />
        </>
      ) : null}

      <NearAPlaceSection f={f} set={set} onAddLocality={onAddLocality} />
      {isRent ? null : <PropertyTypeSections f={f} set={set} idp={idp} />}
      <SpecSections f={f} set={set} idp={idp} />
      <RentExtraSections f={f} set={set} />
      <BuyExtraSections f={f} set={set} idp={idp} />
      <AmenitiesSection f={f} set={set} idp={idp} />
      <VerificationSection f={f} set={set} />
      {showClear ? (
        <>
          <div className="h-px bg-white/10 mt-6 mb-5" />
          <button onClick={clearAll} className="btn btn-primary w-full">
            {t('listings.clearFilters')}
          </button>
        </>
      ) : null}
    </div>
  );
}
