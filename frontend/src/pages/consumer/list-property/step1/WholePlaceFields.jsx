import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PropertyTypeRow from './PropertyTypeRow.jsx';
import RoomCountFields from './RoomCountFields.jsx';
import DimensionFields from './DimensionFields.jsx';
import FurnishingFields from './FurnishingFields.jsx';
import CommercialSection from './CommercialSection.jsx';
import LandSection from './LandSection.jsx';

const WholePlaceFields = ({
  form, set, errors, isResidential, isLand, isCommercial, isHouse,
  toggleInArray, onPropertyType, nextStep,
}) => {
  const { t: tr } = useTranslation();
  return (
    <>
      <PropertyTypeRow form={form} set={set} errors={errors} isResidential={isResidential} isCommercial={isCommercial} onPropertyType={onPropertyType} />
      <RoomCountFields form={form} set={set} errors={errors} isResidential={isResidential} />
      <DimensionFields form={form} set={set} errors={errors} isLand={isLand} isHouse={isHouse} isCommercial={isCommercial} />
      <FurnishingFields form={form} set={set} toggleInArray={toggleInArray} isResidential={isResidential} />
      <CommercialSection form={form} set={set} isCommercial={isCommercial} />
      <LandSection form={form} set={set} isLand={isLand} />

      <div className="flex justify-end">
        <button onClick={nextStep} className="btn-teal px-8 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">
          {tr('listProperty.next')} <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </>
  );
};

export default WholePlaceFields;
