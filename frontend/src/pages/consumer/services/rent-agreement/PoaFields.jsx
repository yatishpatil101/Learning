import { useTranslation } from 'react-i18next';
import DateField from '../../../../components/ui/DateField.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';

// `prefix` is '' for the primary owner and `c{i}` for co-owner i, matching the validation keys.
export default function PoaFields({ prefix, row, set, errors, clearErr, fc, today }) {
  const { t } = useTranslation();
  const field = (k, extra = {}) => ({
    value: row[k] || '',
    onChange: (e) => { set(k, e.target.value); clearErr(prefix + k); },
    className: fc(prefix + k),
    ...extra,
  });
  return (
    <div className="sm:col-span-2 bg-amber-500/6 border border-amber-500/20 rounded-xl p-4">
      <p className="text-white font-semibold text-sm mb-1">{t('services.ra.owner.poa.title')}</p>
      <p className="text-amber-100/80 text-xs mb-3">{t('services.ra.owner.poa.note')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="lbl req">{t('services.ra.owner.poa.principal')}</label><input {...field('poaPrincipal')} placeholder={t('services.ra.owner.fullNamePlaceholder')} /><FieldError show={!!errors[prefix + 'poaPrincipal']}>{t('services.ra.owner.poa.required')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.owner.poa.regNo')}</label><input {...field('poaRegNo')} /><FieldError show={!!errors[prefix + 'poaRegNo']}>{t('services.ra.owner.poa.required')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.owner.poa.sro')}</label><input {...field('poaSro')} placeholder={t('services.ra.owner.poa.sroPlaceholder')} /><FieldError show={!!errors[prefix + 'poaSro']}>{t('services.ra.owner.poa.required')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.owner.poa.date')}</label><DateField value={row.poaDate || ''} onChange={(v) => { set('poaDate', v); clearErr(prefix + 'poaDate'); }} max={today} className={fc(prefix + 'poaDate')} ariaLabel={t('services.ra.owner.poa.date')} /><FieldError show={!!errors[prefix + 'poaDate']}>{t('services.ra.owner.poa.dateErr')}</FieldError></div>
      </div>
    </div>
  );
}
