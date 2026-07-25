import { useTranslation } from 'react-i18next';
import { Pill, FieldError } from '../controls.jsx';
import { lbl3 } from '../styles.js';

const RoomCountFields = ({ form, set, errors, isResidential }) => {
  const { t: tr } = useTranslation();
  if (!isResidential()) return null;
  return (
    /* Bathrooms & Balconies */
    <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div>
        <label className={lbl3}>{tr('listProperty.fields.bathrooms')}</label>
        <div className={`flex flex-wrap gap-2.5 ${errors.bathrooms ? 'pn-invalid-group' : ''}`} data-err="bathrooms">
          {['1', '2', '3', '4'].map((n) => (
            <Pill key={n} selected={form.bathrooms === n} onClick={() => set('bathrooms', n)} className="px-5 py-2.5">{n === '4' ? '4+' : n}</Pill>
          ))}
        </div>
        <FieldError show={!!errors.bathrooms}>{tr('listProperty.err.bathrooms')}</FieldError>
      </div>
      <div>
        <label className={lbl3}>{tr('listProperty.fields.balconies')}</label>
        <div className="flex flex-wrap gap-2.5">
          {[['0', tr('listProperty.opt.none')], ['1', '1'], ['2', '2'], ['3', '3+']].map(([v, l]) => (
            <Pill key={v} selected={form.balconies === v} onClick={() => set('balconies', v)} className="px-5 py-2.5">{l}</Pill>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RoomCountFields;
