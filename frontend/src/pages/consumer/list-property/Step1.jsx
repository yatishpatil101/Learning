import { useTranslation } from 'react-i18next';
import StepHeader from './StepHeader.jsx';
import { isResidentialType } from './constants.js';
import PropertyForToggle from './step1/PropertyForToggle.jsx';
import WholePlaceFields from './step1/WholePlaceFields.jsx';
import FlatmateFields from './step1/FlatmateFields.jsx';

const Step1 = ({
  form, set, rentMode, setRentMode, isFlatmateMode, errors,
  isResidential, isLand, isCommercial, isHouse, toggleInArray, nextStep,
  money, handlePhotoUpload, photos, removePhoto, submitFlatmate, onReset,
}) => {
  const { t: tr } = useTranslation();

  // Flatmate-sharing only applies to a residential home. When the owner picks a
  // commercial unit or land, force the whole-place path so the form can't be left
  // in an impossible "find a flatmate for a warehouse" state.
  const onPropertyType = (v) => {
    set('propertyType', v);
    // A society entity only applies to a residential home. Dropping the binding
    // here keeps a stale societyId from riding along onto a commercial/land unit.
    if (!isResidentialType(v)) { setRentMode('whole'); set('societyId', ''); }
  };
  return (
                <div className="lp-step">
                  <StepHeader title={tr('listProperty.steps.detailsTitle')} subtitle={tr('listProperty.steps.detailsSubtitle')} onReset={onReset} />

                  <PropertyForToggle form={form} set={set} rentMode={rentMode} setRentMode={setRentMode} isResidential={isResidential} />

                  {/* Whole-place step-1 fields */}
                  {!isFlatmateMode && (
                    <WholePlaceFields
                      form={form} set={set} errors={errors}
                      isResidential={isResidential} isLand={isLand} isCommercial={isCommercial} isHouse={isHouse}
                      toggleInArray={toggleInArray} onPropertyType={onPropertyType} nextStep={nextStep}
                    />
                  )}

                  {/* ===== Flatmate form ===== */}
                  {isFlatmateMode && (
                    <FlatmateFields
                      form={form} set={set} errors={errors} isHouse={isHouse}
                      money={money} toggleInArray={toggleInArray}
                      handlePhotoUpload={handlePhotoUpload} photos={photos} removePhoto={removePhoto} submitFlatmate={submitFlatmate}
                    />
                  )}
                </div>
  );
};

export default Step1;
