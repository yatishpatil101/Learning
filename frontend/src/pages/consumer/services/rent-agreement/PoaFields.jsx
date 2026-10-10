import { useTranslation } from 'react-i18next';
import DateField from '../../../../components/ui/DateField.jsx';
import Field from '../../../../components/ui/Field.jsx';

// `prefix` is '' for the primary owner and `c{i}` for co-owner i, matching the validation keys.
export default function PoaFields({ prefix, row, set, errors, clearErr, fc, today }) {
  const { t } = useTranslation();
  const text = (k, label, placeholder) => (
    <Field label={label} required error={errors[prefix + k] && t('services.ra.owner.poa.required')}>
      <input value={row[k] || ''} onChange={(e) => { set(k, e.target.value); clearErr(prefix + k); }} className={fc(prefix + k)} placeholder={placeholder} />
    </Field>
  );
  return (
    <div className="sm:col-span-2 bg-amber-500/6 border border-amber-500/20 rounded-xl p-4">
      <p className="text-white font-semibold text-sm mb-1">{t('services.ra.owner.poa.title')}</p>
      <p className="text-amber-100/80 text-xs mb-3">{t('services.ra.owner.poa.note')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {text('poaPrincipal', t('services.ra.owner.poa.principal'), t('services.ra.owner.fullNamePlaceholder'))}
        {text('poaRegNo', t('services.ra.owner.poa.regNo'))}
        {text('poaSro', t('services.ra.owner.poa.sro'), t('services.ra.owner.poa.sroPlaceholder'))}
        <Field label={t('services.ra.owner.poa.date')} required error={errors[prefix + 'poaDate'] && t('services.ra.owner.poa.dateErr')}><DateField value={row.poaDate || ''} onChange={(v) => { set('poaDate', v); clearErr(prefix + 'poaDate'); }} max={today} className={fc(prefix + 'poaDate')} ariaLabel={t('services.ra.owner.poa.date')} /></Field>
      </div>
    </div>
  );
}
