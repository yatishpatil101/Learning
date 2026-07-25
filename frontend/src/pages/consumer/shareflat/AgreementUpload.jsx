import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { readAgreementDoc } from './helpers.js';

// Tenant evidence upload. The registered rent agreement is the artifact Ops
// reviews before a replacement post earns its Tenant-verified badge. Styled with
// Tailwind utilities (not page-scoped CSS) so it matches both the share-flat modal
// and the list-property wizard's dark/teal surfaces.
export default function AgreementUpload({ doc, onChange, hint, ariaLabel }) {
  const { t } = useTranslation();
  const pick = (file) => { if (file) readAgreementDoc(file).then(onChange).catch(() => onChange(null)); };
  return (
    <div>
      <label className={'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition ' + (doc ? 'border-teal-400/50 bg-teal-500/10' : 'border-white/15 bg-white/5 hover:border-teal-400/40')}>
        <input type="file" className="hidden" accept="image/*,.pdf" aria-label={ariaLabel || t('shareFlat.uploadAgreementAria')} onChange={(e) => pick(e.target.files?.[0])} />
        <Icon name={doc ? 'file-check' : 'upload-cloud'} className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span className={'text-sm truncate ' + (doc ? 'text-teal-200' : 'text-gray-400')}>
          {doc ? doc.name : t('shareFlat.uploadAgreementCta')}
        </span>
        {doc && <Icon name="shield-check" className="w-4 h-4 text-teal-300 ml-auto flex-shrink-0" />}
      </label>
      {hint && <p className="text-[11px] text-gray-500 mt-1.5">{hint}</p>}
    </div>
  );
}
