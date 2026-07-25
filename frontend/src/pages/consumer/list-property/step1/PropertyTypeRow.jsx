import { useTranslation } from 'react-i18next';
import Select from '../../../../components/ui/Select';
import { Pill, FieldError } from '../controls.jsx';
import { lbl3 } from '../styles.js';
import { PROPERTY_TYPES, COMMERCIAL_SUBTYPES } from '../constants.js';

const PropertyTypeRow = ({ form, set, errors, isResidential, isCommercial, onPropertyType }) => {
  const { t: tr } = useTranslation();
  return (
    /* Property Type + BHK — the two most-defining fields share
       one row, keeping the dropdown compact instead of stretched.
       For commercial, the Commercial Type dropdown takes the
       right column so both selectors read as one balanced row. */
    <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div>
        <label className={lbl3}>{tr('listProperty.fields.propertyType')}</label>
        <Select
          value={form.propertyType}
          onChange={onPropertyType}
          placeholder={tr('listProperty.ph.selectPropertyType')}
          dataErr="propertyType"
          invalid={!!errors.propertyType}
          options={PROPERTY_TYPES}
        />
      </div>

      {/* BHK */}
      {isResidential() && (
        <div>
          <label className={lbl3}>{tr('listProperty.fields.bhk')}</label>
          <div className={`flex flex-wrap gap-2.5 ${errors.bhk ? 'pn-invalid-group' : ''}`} data-err="bhk">
            {['1', '2', '3', '4'].map((n) => (
              <Pill key={n} selected={form.bhk === n} onClick={() => set('bhk', n)} className="px-5 py-2.5">{n === '4' ? '4+' : n}</Pill>
            ))}
          </div>
          <FieldError show={!!errors.bhk}>{tr('listProperty.err.bhk')}</FieldError>
        </div>
      )}

      {/* Commercial sub-type — required second choice so a shop and a
         warehouse never share one bucket. Shares the Property Type
         row as a compact dropdown; only surfaces for Commercial. */}
      {isCommercial() && (
        <div>
          <label className={lbl3}>{tr('listProperty.fields.commercialType')}</label>
          <Select
            value={form.commercialType}
            onChange={(v) => set('commercialType', v)}
            placeholder={tr('listProperty.ph.selectCommercialType')}
            dataErr="commercialType"
            invalid={!!errors.commercialType}
            options={COMMERCIAL_SUBTYPES}
          />
          <FieldError show={!!errors.commercialType}>{tr('listProperty.err.commercialType')}</FieldError>
        </div>
      )}
    </div>
  );
};

export default PropertyTypeRow;
