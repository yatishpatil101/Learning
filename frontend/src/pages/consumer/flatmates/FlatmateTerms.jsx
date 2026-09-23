import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';

const fieldLabel = 'block text-xs font-medium text-gray-400 mb-1.5';

export default function FlatmateTerms({ value, onChange }) {
  const { t: tr } = useTranslation();
  const noticePeriodId = useId();
  const lockInId = useId();
  const bill = (name, label) => (
    <div>
      <label className={fieldLabel}>{label}</label>
      <NativeSelect title={label} value={value[name]} onChange={(e) => onChange({ [name]: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm">
        <option value="">{tr('flatmates.billNotStated')}</option>
        <option value="included">{tr('flatmates.billIncluded')}</option>
        <option value="shared">{tr('flatmates.billShared')}</option>
        <option value="separate">{tr('flatmates.billSeparate')}</option>
      </NativeSelect>
    </div>
  );
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <p className="text-xs font-medium text-gray-300">{tr('flatmates.termsHeading')} <span className="text-gray-600">{tr('flatmates.optional')}</span></p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={noticePeriodId} className={fieldLabel}>{tr('flatmates.noticePeriod')}</label>
          <input id={noticePeriodId} type="number" min="0" max="180" value={value.noticePeriodDays} onChange={(e) => onChange({ noticePeriodDays: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('flatmates.noticePeriodPlaceholder')} />
        </div>
        <div>
          <label htmlFor={lockInId} className={fieldLabel}>{tr('flatmates.lockIn')}</label>
          <input id={lockInId} type="number" min="0" max="24" value={value.lockInMonths} onChange={(e) => onChange({ lockInMonths: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('flatmates.lockInPlaceholder')} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {bill('maintenanceBilling', tr('flatmates.maintenanceBill'))}
        {bill('electricityBilling', tr('flatmates.electricityBill'))}
      </div>
    </div>
  );
}
