import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import Field from '../../../../components/ui/Field.jsx';
import { COMMERCIAL_ROUTE, MAX_TENANTS } from './constants.js';
import { pickDoc } from './helpers.js';
import { tenantDocSlots } from './validation.js';
import UploadBox from './UploadBox.jsx';
import IdentityReminderNote from './IdentityReminderNote.jsx';
import PartyIdentityFields from './PartyIdentityFields.jsx';
import TenantPoliceRecord from './TenantPoliceRecord.jsx';

export default function StepTenant({ step, canInvite, tenantMode, setTenantMode, tenants, setTenant, removeTenant, addTenant, errors, clearErr, tenantDocs, setTenantDocs, invite, setInvite, identityReminders }) {
  const { t: tr } = useTranslation();
  const why = (k, fallback) => tr(errors[k] === 'dup' ? (k.endsWith('mobile') || k === 'invMobile' ? 'services.ra.err.dupMobile' : 'services.ra.err.dupAadhaar') : fallback);
  return (
    <div className={'step-panel' + (step === 2 ? ' active' : '')}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-white">{tr('services.ra.tenant.title')}</h2>
        <span className="text-xs text-gray-500">{tenantMode === 'fill' ? tr('services.ra.tenant.count', { count: tenants.length }) : ''}</span>
      </div>
      <p className="text-gray-500 text-sm mb-4">{tr('services.ra.tenant.subtitle')}</p>
      <IdentityReminderNote fields={identityReminders} />
      {canInvite && (
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <button type="button" onClick={() => setTenantMode('fill')} aria-pressed={tenantMode === 'fill'} className={'ra-mode flex flex-col justify-start rounded-xl p-4 text-left ' + (tenantMode === 'fill' ? 'sel' : '')}>
          <span className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="pencil" className="w-4 h-4 text-teal-400" /> {tr('services.ra.tenant.fillTitle')}</span>
          <span className="block text-gray-500 text-xs mt-1">{tr('services.ra.tenant.fillDesc')}</span>
        </button>
        <button type="button" onClick={() => setTenantMode('invite')} aria-pressed={tenantMode === 'invite'} className={'ra-mode flex flex-col justify-start rounded-xl p-4 text-left ' + (tenantMode === 'invite' ? 'sel' : '')}>
          <span className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4 text-teal-400" /> {tr('services.ra.tenant.inviteTitle')}</span>
          <span className="block text-gray-500 text-xs mt-1">{tr('services.ra.tenant.inviteDesc')}</span>
        </button>
      </div>
      )}

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
                  <Field label={tr('services.ra.party.type')} error={errors['t' + i + 'type'] && tr('services.ra.party.entityErr')}>
                    <NativeSelect value={t.type || 'individual'} onChange={(e) => { setTenant(i, 'type', e.target.value); clearErr('t' + i + 'type'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'type'] ? ' err' : '')}>
                      <option value="individual">{tr('services.ra.party.typeOpt.individual')}</option>
                      <option value="entity">{tr('services.ra.party.typeOpt.entity')}</option>
                    </NativeSelect>
                  </Field>
                  <Field label={tr('services.ra.party.residency')}>
                    <NativeSelect value={t.residency || 'resident'} onChange={(e) => { setTenant(i, 'residency', e.target.value); setTenantDocs((d) => { const next = { ...d }; delete next[`t${i}-1`]; delete next[`t${i}-4`]; return next; }); clearErr('t' + i + 'residency'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'residency'] ? ' err' : '')}>
                      {['resident', 'nri', 'foreign'].map((r) => <option key={r} value={r}>{tr(`services.ra.party.residencyOpt.${r}`)}</option>)}
                    </NativeSelect>
                  </Field>
                  {t.type === 'entity' && (
                    <div className="sm:col-span-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100 leading-relaxed">
                      {tr('services.ra.party.entityNote')}{' '}
                      <Link to={COMMERCIAL_ROUTE} className="font-semibold text-teal-300 hover:underline">{tr('services.ra.party.quoteCta')}</Link>
                    </div>
                  )}
                  {(t.residency === 'nri' || t.residency === 'foreign') && <div className="sm:col-span-2 rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-xs text-sky-100 leading-relaxed">{tr('services.ra.party.offlineNote')}</div>}
                  <Field label={tr('services.ra.tenant.fullName')} required error={errors['t' + i + 'name'] && tr('services.ra.tenant.fullNameErr')}><input value={t.name} onChange={(e) => { setTenant(i, 'name', e.target.value); clearErr('t' + i + 'name'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'name'] ? ' err' : '')} placeholder={tr('services.ra.tenant.fullNamePlaceholder')} /></Field>
                  <PartyIdentityFields mother={t.mother} dob={t.dob} alias={t.alias} age={t.age} setMother={(v) => setTenant(i, 'mother', v)} setDob={(v) => setTenant(i, 'dob', v)} setAlias={(v) => setTenant(i, 'alias', v)} setAge={(v) => setTenant(i, 'age', v)} keys={{ mother: 't' + i + 'mother', dob: 't' + i + 'dob', alias: 't' + i + 'alias', age: 't' + i + 'age' }} errors={errors} clearErr={clearErr} />
                  <div className="grid grid-cols-2 gap-3">
                   <Field label={tr('services.ra.tenant.age')} required error={errors['t' + i + 'age'] && (tr(errors['t' + i + 'age'] === 'match' ? 'services.ra.err.ageDob' : 'services.ra.err.adult'))}><input inputMode="numeric" value={t.age} onChange={(e) => { setTenant(i, 'age', e.target.value.replace(/\D/g, '')); clearErr('t' + i + 'age'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'age'] ? ' err' : '')} placeholder={tr('services.ra.tenant.agePlaceholder')} /></Field>
                    <Field label={tr('services.ra.tenant.gender')}><NativeSelect value={t.gender} onChange={(e) => setTenant(i, 'gender', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm"><option value="">{tr('services.ra.owner.genderPlaceholder')}</option>{['Male', 'Female', 'Other'].map((o) => <option key={o}>{o}</option>)}</NativeSelect></Field>
                  </div>
                  <Field label={tr('services.ra.tenant.occupation')}><input value={t.occupation} onChange={(e) => setTenant(i, 'occupation', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.occupationPlaceholder')} /></Field>
                  <Field label={tr('services.ra.tenant.relation')}><input value={t.relation} onChange={(e) => setTenant(i, 'relation', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.relationPlaceholder')} /></Field>
                  <Field label={tr('services.ra.tenant.pan')} required error={errors['t' + i + 'pan'] && tr('services.ra.tenant.panErr')}><input maxLength={10} value={t.pan} onChange={(e) => { setTenant(i, 'pan', e.target.value.toUpperCase()); clearErr('t' + i + 'pan'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm uppercase' + (errors['t' + i + 'pan'] ? ' err' : '')} placeholder="ABCDE1234F" /></Field>
                  {t.residency === 'nri' || t.residency === 'foreign' ? (
                    <>
                      <Field label={tr('services.ra.party.passport')} required error={errors['t' + i + 'passport'] && tr('services.ra.party.passportErr')}><input maxLength={20} value={t.passport || ''} onChange={(e) => { setTenant(i, 'passport', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); clearErr('t' + i + 'passport'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'passport'] ? ' err' : '')} placeholder={tr('services.ra.party.passportPlaceholder')} /></Field>
                      {t.residency === 'foreign' && <Field label={tr('services.ra.party.visaOci')} required error={errors['t' + i + 'visaOci'] && tr('services.ra.party.visaOciErr')}><input maxLength={40} value={t.visaOci || ''} onChange={(e) => { setTenant(i, 'visaOci', e.target.value); clearErr('t' + i + 'visaOci'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'visaOci'] ? ' err' : '')} placeholder={tr('services.ra.party.visaOciPlaceholder')} /></Field>}
                      {t.residency === 'foreign' && <Field label={tr('services.ra.party.frro')}><input maxLength={40} value={t.frro || ''} onChange={(e) => setTenant(i, 'frro', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.party.frroPlaceholder')} /></Field>}
                    </>
                  ) : (
                    <Field label={tr('services.ra.tenant.aadhaar')} required error={errors['t' + i + 'aadhaar'] && why('t' + i + 'aadhaar', 'services.ra.tenant.aadhaarErr')}><input inputMode="numeric" maxLength={12} value={t.aadhaar} onChange={(e) => { setTenant(i, 'aadhaar', e.target.value.replace(/\D/g, '')); clearErr('t' + i + 'aadhaar'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'aadhaar'] ? ' err' : '')} placeholder={tr('services.ra.tenant.aadhaarPlaceholder')} /></Field>
                  )}
                  <Field label={tr('services.ra.tenant.mobile')} required error={errors['t' + i + 'mobile'] && why('t' + i + 'mobile', 'services.ra.tenant.mobileErr')}><MobileField value={t.mobile} onChange={(v) => { setTenant(i, 'mobile', v); clearErr('t' + i + 'mobile'); }} error={!!errors['t' + i + 'mobile']} placeholder={tr('services.ra.tenant.mobilePlaceholder')} inputClassName="px-4 py-3" /></Field>
                  <Field label={tr('services.ra.tenant.email')} error={errors['t' + i + 'email'] && tr('services.ra.err.email')}><input type="email" value={t.email} onChange={(e) => { setTenant(i, 'email', e.target.value); clearErr('t' + i + 'email'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors['t' + i + 'email'] ? ' err' : '')} placeholder="you@example.com" /></Field>
                  <Field className="sm:col-span-2" label={tr('services.ra.tenant.address')} required error={errors['t' + i + 'addr'] && tr('services.ra.tenant.addressErr')}><textarea rows={2} value={t.addr} onChange={(e) => { setTenant(i, 'addr', e.target.value); clearErr('t' + i + 'addr'); }} className={'field w-full px-4 py-3 rounded-xl text-white text-sm resize-none' + (errors['t' + i + 'addr'] ? ' err' : '')} placeholder={tr('services.ra.tenant.addressPlaceholder')} /></Field>
                  <TenantPoliceRecord tenant={t} index={i} setTenant={setTenant} errors={errors} clearErr={clearErr} tenantDocs={tenantDocs} setTenantDocs={setTenantDocs} />
                </div>
                <p className="text-xs font-semibold text-gray-300 mt-4 mb-2 flex items-center gap-2"><Icon name="paperclip" className="w-3.5 h-3.5 text-teal-400" /> {tr('services.ra.tenant.documents')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {tenantDocSlots(t, i).filter(({ slug }) => slug !== 'addressproof' && slug !== 'prevaddressproof').map(({ key, slug, required }) => <UploadBox key={key} label={tr(`services.ra.tenant.doc.${slug}`)} required={required} error={errors['doc-' + key]} fileName={tenantDocs[key]?.fileName} preview={tenantDocs[key]} onPick={async (f) => { if (await pickDoc(f, tenantDocs[key], setTenantDocs, key)) clearErr('doc-' + key); }} />)}
                </div>
              </div>
            ))}
          </div>
          {tenants.length < MAX_TENANTS && <button type="button" onClick={addTenant} className="btn-outline mt-5 px-5 py-3 rounded-xl text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4" /> {tr('services.ra.tenant.addAnother')}</button>}
        </div>
      ) : (
        <div>
          <div className="space-y-4 mb-4">
            {tenants.map((t, i) => (
              <div key={i} className="tenant-block bg-white/4 border border-white/8 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white font-semibold text-sm flex items-center gap-2"><span className="w-6 h-6 rounded-lg bg-teal-400/15 text-teal-400 flex items-center justify-center text-xs font-bold">{i + 1}</span> {tr('services.ra.tenant.tenantLabel')}</p>
                  {tenants.length > 1 && <button type="button" onClick={() => removeTenant(i)} className="text-gray-500 hover:text-red-400 text-xs flex items-center gap-1"><Icon name="trash-2" className="w-3.5 h-3.5" /> {tr('services.ra.tenant.remove')}</button>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={tr('services.ra.tenant.inviteMobile')} required error={errors['t' + i + 'mobile'] && why('t' + i + 'mobile', 'services.ra.tenant.inviteMobileErr')}><MobileField value={t.mobile} onChange={(v) => { setTenant(i, 'mobile', v); clearErr('t' + i + 'mobile'); }} error={!!errors['t' + i + 'mobile']} placeholder={tr('services.ra.tenant.mobilePlaceholder')} inputClassName="px-4 py-3" /></Field>
                  <Field label={tr('services.ra.tenant.inviteName')}><input value={t.name} onChange={(e) => setTenant(i, 'name', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={tr('services.ra.tenant.inviteNamePlaceholder')} /></Field>
                </div>
              </div>
            ))}
          </div>
          {tenants.length < MAX_TENANTS && <button type="button" onClick={addTenant} className="btn-outline mb-4 px-5 py-3 rounded-xl text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4" /> {tr('services.ra.tenant.addAnother')}</button>}
          <Field className="mb-3" label={tr('services.ra.tenant.message')}><textarea rows={2} value={invite.invMessage} onChange={(e) => setInvite((p) => ({ ...p, invMessage: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm resize-none" placeholder={tr('services.ra.tenant.messagePlaceholder')} /></Field>
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
