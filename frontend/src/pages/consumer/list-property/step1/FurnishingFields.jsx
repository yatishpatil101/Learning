import { useTranslation } from 'react-i18next';
import FeatureSelector from '../../../../components/ui/FeatureSelector';
import { Pill } from '../controls.jsx';
import { lbl, lbl3 } from '../styles.js';
import { furnitureItems } from '../constants.js';

const FurnishingFields = ({ form, set, toggleInArray, isResidential }) => {
  const { t: tr } = useTranslation();
  if (!isResidential()) return null;
  return (
    <>
      {/* Furnishing */}
      <div className="mb-6">
        <label className={lbl3}>{tr('listProperty.fields.furnishingStatus')}</label>
        <div className="flex flex-wrap gap-3">
          {[['unfurnished', tr('listProperty.opt.unfurnished')], ['semi', tr('listProperty.opt.semiFurnished')], ['furnished', tr('listProperty.opt.furnished')]].map(([v, l]) => (
            <Pill key={v} selected={form.furnishing === v} onClick={() => set('furnishing', v)} className="px-6 py-3">{l}</Pill>
          ))}
        </div>
      </div>

      {/* Furniture */}
      {(form.furnishing === 'furnished' || form.furnishing === 'semi') && (
        <div className="mb-8">
          <label className={`${lbl} mb-1`}>{tr('listProperty.fields.whatsIncluded')}</label>
          <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.furnitureIncluded', { what: tr('listProperty.word.property') })}</p>
          <FeatureSelector
            options={furnitureItems}
            values={form.furniture}
            onToggle={(label) => toggleInArray('furniture', label)}
            placeholder={tr('listProperty.ph.addOtherFurniture')}
            addAriaLabel={tr('listProperty.aria.furnitureItem')}
          />
        </div>
      )}
    </>
  );
};

export default FurnishingFields;
