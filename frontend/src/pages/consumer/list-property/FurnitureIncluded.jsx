import { useTranslation } from 'react-i18next';
import FeatureSelector from '../../../components/ui/FeatureSelector';
import { lbl } from './styles.js';
import { furnitureItems } from './constants.js';

export default function FurnitureIncluded({ form, toggleInArray, whatKey }) {
  const { t } = useTranslation();
  const fitted = form.furnishing === 'unfurnished';
  return (
    <div className="mb-8" data-testid="in-flat-features">
      <label className={`${lbl} mb-1`}>{t(fitted ? 'listProperty.fields.whatsFitted' : 'listProperty.fields.whatsIncluded')}</label>
      <p className="text-gray-600 text-xs mb-3">{t(fitted ? 'listProperty.help.fittedIncluded' : 'listProperty.help.furnitureIncluded', { what: t(whatKey) })}</p>
      <FeatureSelector
        options={furnitureItems}
        values={form.furniture}
        onToggle={(label) => toggleInArray('furniture', label)}
        placeholder={t('listProperty.ph.addOtherFurniture')}
        addAriaLabel={t('listProperty.aria.furnitureItem')}
      />
    </div>
  );
}
