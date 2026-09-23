import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { readAgreementDoc } from './helpers.js';

// The registration fields make the upload checkable: stamp paper and a registered Leave & License
// agreement look alike at the Ops desk, and only the sub-registrar's number keys the IGR portal.
export default function AgreementUpload({ doc, onChange, hint, ariaLabel, registration, onRegistrationChange }) {
  const { t } = useTranslation();
  const pick = (file) => { if (file) readAgreementDoc(file).then(onChange).catch(() => onChange(null)); };
  const reg = registration || {};
  const setReg = (patch) => onRegistrationChange && onRegistrationChange({ ...reg, ...patch });
  const field = 'w-full rounded-xl px-3.5 py-2.5 text-sm bg-white/5 border border-white/15 text-gray-100 placeholder-gray-500 focus:border-teal-400/50 focus:outline-none';
  const label = 'block text-[11px] font-medium text-gray-400 mb-1.5';

  return (
    <div className="space-y-3">
      <label className={'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition ' + (doc ? 'border-teal-400/50 bg-teal-500/10' : 'border-white/15 bg-white/5 hover:border-teal-400/40')}>
        <input type="file" className="hidden" accept="image/*,.pdf" aria-label={ariaLabel || t('flatmates.uploadAgreementAria')} onChange={(e) => pick(e.target.files?.[0])} />
        <Icon name={doc ? 'file-check' : 'upload-cloud'} className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span className={'text-sm truncate ' + (doc ? 'text-teal-200' : 'text-gray-400')}>
          {doc ? doc.name : t('flatmates.uploadAgreementCta')}
        </span>
        {doc && <Icon name="shield-check" className="w-4 h-4 text-teal-300 ml-auto flex-shrink-0" />}
      </label>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}

      {onRegistrationChange && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3" data-testid="agreement-registration">
          <div>
            <label className={label} htmlFor="agreement-reg-no">{t('flatmates.regNoLabel')}</label>
            <input
              id="agreement-reg-no"
              value={reg.regNo || ''}
              onChange={(e) => setReg({ regNo: e.target.value.slice(0, 60) })}
              maxLength={60}
              placeholder={t('flatmates.regNoPlaceholder')}
              className={field}
            />
            <p className="text-[11px] text-gray-500 mt-1.5">{t('flatmates.regNoHelp')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="agreement-registered-on">{t('flatmates.registeredOnLabel')}</label>
              <input id="agreement-registered-on" type="date" value={reg.registeredOn || ''} onChange={(e) => setReg({ registeredOn: e.target.value })} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="agreement-valid-till">{t('flatmates.validTillLabel')}</label>
              <input id="agreement-valid-till" type="date" value={reg.validTill || ''} onChange={(e) => setReg({ validTill: e.target.value })} className={field} />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">{t('flatmates.validTillHelp')}</p>
          {/* The other half of "you need a registered agreement": Draazy sells the registration
              itself, so offering it here is the difference between a requirement and a dead end. */}
          <p className="text-[11px] text-gray-400">
            {t('flatmates.noAgreementPre')}{' '}
            <Link to="/services/rent-agreement?from=flatmates" className="text-teal-300 font-semibold underline" data-testid="agreement-service-link">
              {t('flatmates.noAgreementCta')}
            </Link>{' '}
            {t('flatmates.noAgreementSuf')}
          </p>
        </div>
      )}

      {/* Duties the host carries whatever we do. Shown rather than linked: a tenant who skips a
          link does not stop owing these, and the police intimation in particular is the one people
          find out about from a constable. */}
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3" data-testid="tenant-disclosure">
        <p className="text-[11px] font-semibold text-amber-200 inline-flex items-center gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0" /> {t('flatmates.disclosureTitle')}
        </p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-gray-400 list-disc pl-4">
          <li>{t('flatmates.disclosureConsent')}</li>
          <li>{t('flatmates.disclosurePolice')}</li>
          <li>{t('flatmates.disclosureRegistration')}</li>
        </ul>
      </div>
    </div>
  );
}
