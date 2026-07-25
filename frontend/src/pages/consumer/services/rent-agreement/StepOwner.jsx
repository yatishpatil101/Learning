import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import { OWNER_DOCS, OWNER_DOCS_REQUIRED } from './constants.js';
import { readFileAsDataURL } from './helpers.js';
import UploadBox from './UploadBox.jsx';

export default function StepOwner({ step, owner, setO, errors, fc, clearErr, ownerDocs, setOwnerDocs, vaultEnabled, onDocSaved }) {
  const { t } = useTranslation();
  return (
    <div className={'step-panel' + (step === 1 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{t('services.ra.owner.title')}</h2>
      <p className="text-gray-500 text-sm mb-6">{t('services.ra.owner.subtitle')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="lbl req">{t('services.ra.owner.fullName')}</label><input value={owner.oName} onChange={(e) => { setO('oName', e.target.value); clearErr('oName'); }} className={fc('oName')} placeholder={t('services.ra.owner.fullNamePlaceholder')} /><FieldError show={!!errors.oName}>{t('services.ra.owner.fullNameErr')}</FieldError></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">{t('services.ra.owner.age')}</label><input inputMode="numeric" value={owner.oAge} onChange={(e) => setO('oAge', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.owner.agePlaceholder')} /></div>
          <div><label className="lbl">{t('services.ra.owner.gender')}</label><NativeSelect value={owner.oGender} onChange={(e) => setO('oGender', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">{['Male', 'Female', 'Other'].map((o) => <option key={o}>{o}</option>)}</NativeSelect></div>
        </div>
        <div><label className="lbl req">{t('services.ra.owner.pan')}</label><input maxLength={10} value={owner.oPan} onChange={(e) => { setO('oPan', e.target.value.toUpperCase()); clearErr('oPan'); }} className={fc('oPan') + ' uppercase'} placeholder="ABCDE1234F" /><FieldError show={!!errors.oPan}>{t('services.ra.owner.panErr')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.owner.aadhaar')}</label><input inputMode="numeric" maxLength={12} value={owner.oAadhaar} onChange={(e) => { setO('oAadhaar', e.target.value.replace(/\D/g, '')); clearErr('oAadhaar'); }} className={fc('oAadhaar')} placeholder={t('services.ra.owner.aadhaarPlaceholder')} /><FieldError show={!!errors.oAadhaar}>{t('services.ra.owner.aadhaarErr')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.owner.mobile')}</label><MobileField value={owner.oMobile} onChange={(v) => { setO('oMobile', v); clearErr('oMobile'); }} error={!!errors.oMobile} placeholder={t('services.ra.owner.mobilePlaceholder')} inputClassName="px-4 py-3" /><FieldError show={!!errors.oMobile}>{t('services.ra.owner.mobileErr')}</FieldError></div>
        <div><label className="lbl">{t('services.ra.owner.email')}</label><input type="email" value={owner.oEmail} onChange={(e) => setO('oEmail', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder="you@example.com" /></div>
        <div className="sm:col-span-2"><label className="lbl req">{t('services.ra.owner.address')}</label><textarea rows={2} value={owner.oAddr} onChange={(e) => { setO('oAddr', e.target.value); clearErr('oAddr'); }} className={fc('oAddr') + ' resize-none'} placeholder={t('services.ra.owner.addressPlaceholder')} /><FieldError show={!!errors.oAddr}>{t('services.ra.owner.addressErr')}</FieldError></div>
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Icon name="paperclip" className="w-4 h-4 text-teal-400" /> {t('services.ra.owner.uploadDocs')}</h3>
        <p className="text-gray-500 text-xs mb-3">{t('services.ra.owner.uploadHint')}</p>
        {vaultEnabled && (
          <p className="text-teal-300/80 text-xs mb-3 flex items-start gap-1.5"><Icon name="folder-check" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {t('services.ra.owner.vaultNote')}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {OWNER_DOCS.map(([, k]) => {
            const d = ownerDocs[k];
            const vaultState = !vaultEnabled || !d ? null : d.fromVault ? 'reused' : (d.dataUrl && !d.tooLarge ? 'saved' : null);
            return (
              <UploadBox
                key={k}
                label={t(`services.ra.owner.doc.${k}`)}
                fileName={d?.fileName}
                preview={d}
                vaultState={vaultState}
                required={OWNER_DOCS_REQUIRED.includes(k)}
                onPick={async (f) => { const nd = await readFileAsDataURL(f); if (nd) { setOwnerDocs((s) => ({ ...s, [k]: nd })); onDocSaved?.(k, nd); } }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
