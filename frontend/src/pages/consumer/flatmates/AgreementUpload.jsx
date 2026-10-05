import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { readAgreementDoc } from './helpers.js';

export default function AgreementUpload({ doc, onChange, ariaLabel }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const pick = (file) => {
    if (!file) return;
    onChange({ name: file.name, uploading: true });
    readAgreementDoc(file).then(onChange).catch((error) => {
      onChange(null);
      toast(error?.message || t('common.somethingWentWrong'), 'error');
    });
  };
  return (
    <div className="space-y-3">
      <label className={'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition ' + (doc ? 'border-teal-400/50 bg-teal-500/10' : 'border-white/15 bg-white/5 hover:border-teal-400/40')}>
        <input type="file" className="hidden" accept="image/*,.pdf" aria-label={ariaLabel || t('flatmates.uploadAgreementAria')} onChange={(e) => pick(e.target.files?.[0])} />
        <Icon name={doc?.uploading ? 'loader' : doc ? 'file-check' : 'upload-cloud'} className={'w-5 h-5 text-teal-400 flex-shrink-0' + (doc?.uploading ? ' animate-spin' : '')} />
        <span className={'text-sm truncate ' + (doc ? 'text-teal-200' : 'text-gray-400')} aria-live="polite">
          {doc?.uploading ? t('common.uploading') : doc ? doc.name : t('flatmates.uploadAgreementCta')}
        </span>
        {doc?.id && <Icon name="shield-check" className="w-4 h-4 text-teal-300 ml-auto flex-shrink-0" />}
      </label>

      <p className="text-[11px] text-gray-400">
        {t('flatmates.noAgreementPre')}{' '}
        <Link to="/services/rent-agreement?from=flatmates" className="text-teal-300 font-semibold underline" data-testid="agreement-service-link">
          {t('flatmates.noAgreementCta')}
        </Link>
      </p>

      <p className="flex items-start gap-1.5 text-[11px] text-amber-200/90" data-testid="tenant-disclosure">
        <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {t('flatmates.disclosure')}
      </p>
    </div>
  );
}
