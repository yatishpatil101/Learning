import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import { docReady } from './validation.js';

export default function UploadBox({ label, fileName, onPick, preview, vaultState, required, error }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const errId = useId();
  const refused = preview?.error ? preview : preview?.rejected;
  const invalid = !!(error || refused);
  const accepted = fileName && docReady(preview);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await onPick(file); } finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <div>
      <label className="lbl flex items-center gap-2">
        <span className={required ? 'req' : ''}>{label}</span>
        {vaultState && (
          <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ' + (vaultState === 'reused' ? 'bg-teal-500/15 text-teal-300' : 'bg-emerald-500/15 text-emerald-300')}>
            <Icon name={vaultState === 'reused' ? 'folder-check' : 'check'} className="w-3 h-3" />
            {t(vaultState === 'reused' ? 'services.ra.owner.vaultReused' : 'services.ra.owner.vaultSaved')}
          </span>
        )}
      </label>
      <label className={'upload-box flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer focus-within:ring-2 focus-within:ring-teal-400' +       (accepted ? ' has-file' : '') + (invalid ? ' err' : '')}>
              <input type="file" className="sr-only" aria-label={label} aria-invalid={invalid || undefined} aria-describedby={!busy && invalid ? errId : undefined} aria-disabled={busy || undefined} accept="image/*,.pdf" onChange={pick} />
        <Icon name="upload-cloud" className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span className="upload-name text-sm text-gray-400 truncate" aria-live="polite">{busy ? t('services.ra.upload.preparing') : accepted ? fileName : preview?.reattach ? t('services.ra.upload.reattach', { name: preview.fileName }) : t('services.ra.upload.clickToUpload')}</span>
      </label>
      <FieldError id={errId} alert={false} show={!busy && invalid}>{refused ? t('services.ra.upload.failed', { name: refused.fileName, reason: refused.error }) : t('services.ra.err.docRequired')}</FieldError>
      {preview?.dataUrl && (
        <div className="mt-2">
          {preview.mime?.startsWith('image/') ? (
            <img src={preview.dataUrl} alt={t('services.ra.upload.previewAlt')} className="w-20 h-20 rounded-lg object-cover border border-white/10" />
          ) : (
            <div className="text-xs text-gray-500 flex items-center gap-1"><Icon name="file" className="w-3.5 h-3.5" /> {preview.fileName}</div>
          )}
        </div>
      )}
    </div>
  );
}
