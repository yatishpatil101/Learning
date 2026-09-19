import { Tag, Key, Home, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Pill } from './controls.jsx';
import StepHeader from './StepHeader.jsx';
import { lbl3 } from './styles.js';
import PropertyDetailsWhole from './PropertyDetailsWhole.jsx';
import PropertyDetailsFlatmate from './PropertyDetailsFlatmate.jsx';

const PropertyDetailsStep = ({
  form, set, onPropertyType, onCommercialType, rentMode, setRentMode, isFlatmateMode, errors,
  isResidential, isLand, isCommercial, isHouse, toggleInArray, nextStep,
  money, onReset, allowFlatmate = true,
}) => {
  const { t: tr } = useTranslation();

  // Flatmate-sharing only applies to a whole residential home. Switching type resets
  // rentMode to "whole" for non-residential types (handled by the parent cascade).
  return (
                <div className="lp-step">
                  <StepHeader title={tr('listProperty.steps.detailsTitle')} subtitle={tr('listProperty.steps.detailsSubtitle')} onReset={onReset} />

                  {/* Property For */}
                  <div className="mb-6">
                    <label className={lbl3}>{tr('listProperty.fields.propertyFor')}</label>
                    <div className="flex flex-wrap gap-3">
                      <Pill selected={form.deal === 'buy'} onClick={() => set('deal', 'buy')} className="px-6 py-3">
                        <span className="flex items-center gap-2"><Tag className="w-4 h-4" />{tr('listProperty.opt.sale')}</span>
                      </Pill>
                      <Pill selected={form.deal === 'rent'} onClick={() => set('deal', 'rent')} className="px-6 py-3">
                        <span className="flex items-center gap-2"><Key className="w-4 h-4" />{tr('listProperty.opt.rent')}</span>
                      </Pill>
                    </div>
                  </div>

                  {/* Rent sub-mode — only a residential home can be shared with a
                     flatmate, so this choice is hidden for commercial & land. */}
                  {allowFlatmate && form.deal === 'rent' && isResidential() && (
                    <div className="mb-6">
                      <label className={lbl3}>{tr('listProperty.fields.whatToDo')}</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Pill selected={rentMode === 'whole'} onClick={() => setRentMode('whole')} className="p-4">
                          <div className="flex items-start gap-3">
                            <Home className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                            <div><p className="text-sm font-semibold text-white">{tr('listProperty.subMode.wholeTitle')}</p><p className="text-xs text-gray-400 mt-0.5">{tr('listProperty.subMode.wholeDesc')}</p></div>
                          </div>
                        </Pill>
                        <Pill selected={rentMode === 'flatmate'} onClick={() => setRentMode('flatmate')} className="p-4">
                          <div className="flex items-start gap-3">
                            <Users className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                            <div><p className="text-sm font-semibold text-white">{tr('listProperty.subMode.flatmateTitle')}</p><p className="text-xs text-gray-400 mt-0.5">{tr('listProperty.subMode.flatmateDesc')}</p></div>
                          </div>
                        </Pill>
                      </div>
                    </div>
                  )}

                  {/* Whole-place step-1 fields */}
                  {!isFlatmateMode && (
                    <PropertyDetailsWhole
                      form={form} set={set} onPropertyType={onPropertyType} errors={errors}
                      onCommercialType={onCommercialType}
                      isResidential={isResidential} isLand={isLand} isCommercial={isCommercial}
                      isHouse={isHouse} toggleInArray={toggleInArray} nextStep={nextStep}
                    />
                  )}

                  {/* ===== Flatmate form ===== */}
                  {isFlatmateMode && (
                    <PropertyDetailsFlatmate
                      form={form} set={set} errors={errors} isHouse={isHouse}
                      toggleInArray={toggleInArray} nextStep={nextStep}
                    />
                  )}
                </div>
  );
};

export default PropertyDetailsStep;
