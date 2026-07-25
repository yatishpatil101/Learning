import { useTranslation } from 'react-i18next';
import BudgetSection from './filtersPanel/BudgetSection.jsx';
import LocalitySection from './filtersPanel/LocalitySection.jsx';
import NearAPlaceSection from './filtersPanel/NearAPlaceSection.jsx';
import PropertyTypeSections from './filtersPanel/PropertyTypeSections.jsx';
import SpecSections from './filtersPanel/SpecSections.jsx';
import RentExtraSections from './filtersPanel/RentExtraSections.jsx';
import BuyExtraSections from './filtersPanel/BuyExtraSections.jsx';
import AmenitiesSection from './filtersPanel/AmenitiesSection.jsx';
import VerificationSection from './filtersPanel/VerificationSection.jsx';

export default function Filters({ f, set, localities, onAddLocality, clearAll, idp = '', showClear = true }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3.5">
      <BudgetSection f={f} set={set} />
      <LocalitySection f={f} set={set} localities={localities} onAddLocality={onAddLocality} />
      <NearAPlaceSection f={f} set={set} onAddLocality={onAddLocality} />
      <PropertyTypeSections f={f} set={set} idp={idp} />
      <SpecSections f={f} set={set} idp={idp} />
      <RentExtraSections f={f} set={set} idp={idp} />
      <BuyExtraSections f={f} set={set} idp={idp} />
      <AmenitiesSection f={f} set={set} />
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
