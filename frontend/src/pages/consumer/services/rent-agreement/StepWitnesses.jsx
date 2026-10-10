import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import Field from '../../../../components/ui/Field.jsx';
import IdentityReminderNote from './IdentityReminderNote.jsx';
import { dupMessageKey } from './validation.js';

export default function StepWitnesses({ step, wit, setWit, errors, fc, clearErr, identityReminders }) {
  const { t } = useTranslation();
  const set = (k, v) => { setWit((p) => ({ ...p, [k]: v })); clearErr(k); };
  const why = (k, fallback) => t(errors[k] === 'dup' ? dupMessageKey(k) : fallback);
  return (
    <div className={'step-panel' + (step === 4 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{t('services.ra.witnesses.title')}</h2>
      <p className="text-gray-500 text-sm mb-4">{t('services.ra.witnesses.subtitle')}</p>
      <IdentityReminderNote fields={identityReminders} />
      <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3.5 flex items-start gap-2.5 mb-6">
        <Icon name="fingerprint" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
        <p className="text-amber-100/90 text-xs leading-relaxed">{t('services.ra.witnesses.biometricNote')}</p>
      </div>
      <div className="space-y-5">
        {[1, 2].map((n) => {
          const k = (f) => `w${n}${f}`;
          return (
            <div key={n} data-testid={`witness-${n}`} className="bg-white/4 border border-white/8 rounded-xl p-4">
              <p className="text-white font-semibold text-sm mb-3">{t('services.ra.witnesses.witness', { n })}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t('services.ra.witnesses.fullName')} required error={errors[k('Name')] && t('services.ra.witnesses.nameErr')}><input value={wit[k('Name')] || ''} onChange={(e) => set(k('Name'), e.target.value)} className={fc(k('Name'))} placeholder={t('services.ra.owner.fullNamePlaceholder')} /></Field>
                <Field label={t('services.ra.witnesses.age')} required error={errors[k('Age')] && t('services.ra.err.adult')}><input inputMode="numeric" value={wit[k('Age')] || ''} onChange={(e) => set(k('Age'), e.target.value.replace(/\D/g, ''))} className={fc(k('Age'))} placeholder={t('services.ra.owner.agePlaceholder')} /></Field>
                <Field label={t('services.ra.witnesses.mobile')} required error={errors[k('Mobile')] && why(k('Mobile'), 'services.ra.owner.mobileErr')}><MobileField value={wit[k('Mobile')] || ''} onChange={(v) => set(k('Mobile'), v)} error={!!errors[k('Mobile')]} placeholder={t('services.ra.owner.mobilePlaceholder')} inputClassName="px-4 py-3" /></Field>
                <Field label={t('services.ra.witnesses.aadhaar')} required error={errors[k('Aadhaar')] && why(k('Aadhaar'), 'services.ra.owner.aadhaarErr')}><input inputMode="numeric" maxLength={12} value={wit[k('Aadhaar')] || ''} onChange={(e) => set(k('Aadhaar'), e.target.value.replace(/\D/g, ''))} className={fc(k('Aadhaar'))} placeholder={t('services.ra.owner.aadhaarPlaceholder')} /></Field>
                <Field className="sm:col-span-2" label={t('services.ra.witnesses.address')} required error={errors[k('Addr')] && t('services.ra.witnesses.addressErr')}><input value={wit[k('Addr')] || ''} onChange={(e) => set(k('Addr'), e.target.value)} className={fc(k('Addr'))} placeholder={t('services.ra.owner.addressPlaceholder')} /></Field>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}