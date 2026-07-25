import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import { TENANT_DOCS, TENANT_DOCS_REQUIRED } from './constants.js';
import { readFileAsDataURL } from './helpers.js';
import UploadBox from './UploadBox.jsx';

export default function StepTenant({ step, tenantMode, setTenantMode, tenants, setTenant, removeTenant, addTenant, errors, clearErr, tenantDocs, setTenantDocs, invite, setInvite }) {
  const { t: tr } = useTranslation();
  return (
    <div className={'step-panel' + (step === 2 ? ' active' : '')}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-white">{tr('services.ra.tenant.title')}</h2>
        <span className="text-xs text-gray-500">{tenantMode === 'fill' ? tr('services.ra.tenant.count', { count: tenants.length }) : ''}</span>
      </div>
      <p className="text-gray-500 text-sm mb-4">{tr('services.ra.tenant.subtitle')}</p>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <div onClick={() => setTenantMode('fill')} className={'ra-mode rounded-xl p-4 ' + (tenantMode === 'fill' ? 'sel' : '')}>
          <p className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="pencil" className="w-4 h-4 text-teal-400" /> {tr('services.ra.tenant.fillTitle')}</p>
          <p className="text-gray-500 text-xs mt-1">{tr('services.ra.tenant.fillDesc')}</p>
        </div>
        <div onClick={() => setTenantMode('invite')} className={'ra-mode rounded-xl p-4 ' + (tenantMode === 'invite' ? 'sel' : '')}>
          <p className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4 text-teal-400" /> {tr('services.ra.tenant.inviteTitle')}</p>
          <p className="text-gray-500 text-xs mt-1">{tr('services.ra.tenant.inviteDesc')}</p>
        </div>
      </div>

      {tenantMode === 'fill' ? (
        <div>
          <div className="space-y-5">
            {tenants.map((t, i) => (
              <div key={i} className="tenant-block bg-white/4 border border-white/8 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white font-semibold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-teal-400/15 text-teal-400 flex items-center justify-center text-xs font-bold">{i + 1}</span> {tr('services.ra.tenant.tenantLabel')}</p>
                  {tenants.length > 1 && <button type="button" onClick={() => removeTenant(i)} className="text-gray-500 hover:text-red-400 text-xs flex items-center gap-1"><Icon name="trash-2" className="w-3.5 h-3.5" /> {tr('services.ra.tenant.remove')}</button>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="lbl req">{tr('services.ra.tenant.fullName')}</label><input value={t.name} onChange={(e) => { setTenant(i, 'name', e.target.value); clearErr('t' + i + 'name'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'name'] ? ' err' : '')} placeholder={tr('services.ra.tenant.fullNamePlaceholder')} /><FieldError show={!!errors['t' + i + 'name']}>{tr('services.ra.tenant.fullNameErr')}</FieldError></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="lbl">{tr('services.ra.tenant.age')}</label><input inputMode="numeric" value={t.age} onChange={(e) => setTenant(i, 'age', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.agePlaceholder')} /></div>
                    <div><label className="lbl">{tr('services.ra.tenant.gender')}</label><NativeSelect value={t.gender} onChange={(e) => setTenant(i, 'gender', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">{['Male', 'Female', 'Other'].map((o) => <option key={o}>{o}</option>)}</NativeSelect></div>
                  </div>
                  <div><label className="lbl">{tr('services.ra.tenant.occupation')}</label><input value={t.occupation} onChange={(e) => setTenant(i, 'occupation', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.occupationPlaceholder')} /></div>
                  <div><label className="lbl">{tr('services.ra.tenant.relation')}</label><input value={t.relation} onChange={(e) => setTenant(i, 'relation', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.relationPlaceholder')} /></div>
                  <div><label className="lbl req">{tr('services.ra.tenant.pan')}</label><input maxLength={10} value={t.pan} onChange={(e) => { setTenant(i, 'pan', e.target.value.toUpperCase()); clearErr('t' + i + 'pan'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm uppercase' + (errors['t' + i + 'pan'] ? ' err' : '')} placeholder="ABCDE1234F" /><FieldError show={!!errors['t' + i + 'pan']}>{tr('services.ra.tenant.panErr')}</FieldError></div>
                  <div><label className="lbl req">{tr('services.ra.tenant.aadhaar')}</label><input inputMode="numeric" maxLength={12} value={t.aadhaar} onChange={(e) => { setTenant(i, 'aadhaar', e.target.value.replace(/\D/g, '')); clearErr('t' + i + 'aadhaar'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'aadhaar'] ? ' err' : '')} placeholder={tr('services.ra.tenant.aadhaarPlaceholder')} /><FieldError show={!!errors['t' + i + 'aadhaar']}>{tr('services.ra.tenant.aadhaarErr')}</FieldError></div>
                  <div><label className="lbl req">{tr('services.ra.tenant.mobile')}</label><MobileField value={t.mobile} onChange={(v) => { setTenant(i, 'mobile', v); clearErr('t' + i + 'mobile'); }} error={!!errors['t' + i + 'mobile']} placeholder={tr('services.ra.tenant.mobilePlaceholder')} inputClassName="px-4 py-3" /><FieldError show={!!errors['t' + i + 'mobile']}>{tr('services.ra.tenant.mobileErr')}</FieldError></div>
                  <div><label className="lbl">{tr('services.ra.tenant.email')}</label><input type="email" value={t.email} onChange={(e) => setTenant(i, 'email', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder="you@example.com" /></div>
                  <div className="sm:col-span-2"><label className="lbl req">{tr('services.ra.tenant.address')}</label><textarea rows={2} value={t.addr} onChange={(e) => { setTenant(i, 'addr', e.target.value); clearErr('t' + i + 'addr'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm resize-none' + (errors['t' + i + 'addr'] ? ' err' : '')} placeholder={tr('services.ra.tenant.addressPlaceholder')} /><FieldError show={!!errors['t' + i + 'addr']}>{tr('services.ra.tenant.addressErr')}</FieldError></div>
                </div>
                <p className="text-xs font-semibold text-gray-300 mt-4 mb-2 flex items-center gap-2"><Icon name="paperclip" className="w-3.5 h-3.5 text-teal-400" /> {tr('services.ra.tenant.documents')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {TENANT_DOCS.map((l, di) => <UploadBox key={di} label={tr(`services.ra.tenant.doc.${di}`)} required={TENANT_DOCS_REQUIRED.includes(di)} fileName={tenantDocs['t' + i + '-' + di]?.fileName} preview={tenantDocs['t' + i + '-' + di]} onPick={async (f) => { const d = await readFileAsDataURL(f); if (d) setTenantDocs((s) => ({ ...s, ['t' + i + '-' + di]: d })); }} />)}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addTenant} className="btn-outline mt-5 px-5 py-3 rounded-xl text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4" /> {tr('services.ra.tenant.addAnother')}</button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div><label className="lbl req">{tr('services.ra.tenant.inviteMobile')}</label><MobileField value={invite.invMobile} onChange={(v) => { setInvite((p) => ({ ...p, invMobile: v })); clearErr('invMobile'); }} error={!!errors.invMobile} placeholder={tr('services.ra.tenant.mobilePlaceholder')} inputClassName="px-4 py-3" /><FieldError show={!!errors.invMobile}>{tr('services.ra.tenant.inviteMobileErr')}</FieldError></div>
            <div><label className="lbl">{tr('services.ra.tenant.inviteName')}</label><input value={invite.invName} onChange={(e) => setInvite((p) => ({ ...p, invName: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.inviteNamePlaceholder')} /></div>
          </div>
          <div className="mb-3"><label className="lbl">{tr('services.ra.tenant.message')}</label><textarea rows={2} value={invite.invMessage} onChange={(e) => setInvite((p) => ({ ...p, invMessage: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm resize-none" placeholder={tr('services.ra.tenant.messagePlaceholder')} /></div>
          <div className="bg-teal-500/8 border border-teal-500/20 rounded-xl p-3.5 flex items-start gap-2.5">
            <Icon name="shield-check" className="w-4 h-4 text-teal-300 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">{tr('services.ra.tenant.inviteInfo')}</p>
          </div>
          <div className="bg-white/4 border border-white/8 rounded-xl p-3.5 flex items-start gap-2.5 mt-3">
            <Icon name="info" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-gray-300 text-xs leading-relaxed">{tr('services.ra.tenant.inviteFinishNote')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
