import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';

export default function UploadBox({ label, fileName, onPick, preview, vaultState, required }) {
  const { t } = useTranslation();
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
      <label className={'upload-box flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer' + (fileName ? ' has-file' : '')}>
        <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { if (e.target.files?.[0]) onPick(e.target.files[0]); }} />
        <Icon name="upload-cloud" className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span className="upload-name text-sm text-gray-400 truncate">{fileName || t('services.ra.upload.clickToUpload')}</span>
      </label>
      {preview && (
        <div className="mt-2">
          {preview.mime && preview.mime.startsWith('image/') ? (
            <img src={preview.dataUrl} alt={t('services.ra.upload.previewAlt')} className="w-20 h-20 rounded-lg object-cover border border-white/10" />
          ) : (
            <div className="text-xs text-gray-500 flex items-center gap-1"><Icon name="file" className="w-3.5 h-3.5" /> {preview.fileName}</div>
          )}
        </div>
      )}
    </div>
  );
}
