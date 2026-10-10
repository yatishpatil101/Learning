import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import Icon from '../../../../components/Icon.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import Field from '../../../../components/ui/Field.jsx';
import { COMMERCIAL_ROUTE, MAX_LICENSORS } from './constants.js';
import { pickDoc } from './helpers.js';
import { dupMessageKey, ownerDocSlots, todayIst } from './validation.js';
import CoOwnerBlock from './CoOwnerBlock.jsx';
import PoaFields from './PoaFields.jsx';
import UploadBox from './UploadBox.jsx';
import IdentityReminderNote from './IdentityReminderNote.jsx';
import PartyIdentityFields from './PartyIdentityFields.jsx';

export default function StepOwner({ step, owner, setO, coOwners, setCoOwner, addCoOwner, removeCoOwner, errors, fc, clearErr, ownerDocs, setOwnerDocs, vaultEnabled, onDocSaved, canInvite, ownerMode, chooseOwnerMode, invite, setInvite, identityReminders }) {
  const { t } = useTranslation();
  const today = todayIst();
  const why = (k, fallback) => t(errors[k] === 'dup' ? dupMessageKey(k) : fallback);
  const capacities = coOwners.length ? ['co-owner', 'poa'] : ['owner', 'poa'];
  const offline = owner.residency === 'nri' || owner.residency === 'foreign';
  return (
    <div className={'step-panel' + (step === 1 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{t('services.ra.owner.title')}</h2>
      <p className="text-gray-500 text-sm mb-6">{t('services.ra.owner.subtitle')}</p>
      <IdentityReminderNote fields={identityReminders} />
      {canInvite && (
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {[['fill', 'pencil'], ['invite', 'user-plus']].map(([m, icon]) => (
            <button key={m} type="button" onClick={() => chooseOwnerMode(m)} aria-pressed={ownerMode === m} className={'ra-mode flex flex-col justify-start rounded-xl p-4 text-left ' + (ownerMode === m ? 'sel' : '')}>
              <span className="text-white font-semibold text-sm flex items-center gap-2"><Icon name={icon} className="w-4 h-4 text-teal-400" /> {t(`services.ra.owner.${m}Title`)}</span>
              <span className="block text-gray-500 text-xs mt-1">{t(`services.ra.owner.${m}Desc`)}</span>
            </button>
          ))}
        </div>
      )}
      {canInvite && ownerMode === 'invite' ? (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Field label={t('services.ra.owner.inviteMobile')} required error={errors.invMobile && why('invMobile', 'services.ra.owner.inviteMobileErr')}><MobileField value={invite.invMobile} onChange={(v) => { setInvite((p) => ({ ...p, invMobile: v })); clearErr('invMobile'); }} error={!!errors.invMobile} placeholder={t('services.ra.owner.mobilePlaceholder')} inputClassName="px-4 py-3" /></Field>
            <Field label={t('services.ra.owner.inviteName')}><input value={invite.invName} onChange={(e) => setInvite((p) => ({ ...p, invName: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.owner.inviteNamePlaceholder')} /></Field>
          </div>
          <Field className="mb-3" label={t('services.ra.tenant.message')}><textarea rows={2} value={invite.invMessage} onChange={(e) => setInvite((p) => ({ ...p, invMessage: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm resize-none" placeholder={t('services.ra.owner.messagePlaceholder')} /></Field>
          <div className="bg-teal-500/8 border border-teal-500/20 rounded-xl p-3.5 flex items-start gap-2.5">
            <Icon name="shield-check" className="w-4 h-4 text-teal-300 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">{t('services.ra.owner.inviteInfo')}</p>
          </div>
          <div className="bg-white/4 border border-white/8 rounded-xl p-3.5 flex items-start gap-2.5 mt-3">
            <Icon name="info" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-gray-300 text-xs leading-relaxed">{t('services.ra.owner.inviteFinishNote')}</p>
          </div>
        </div>
      ) : (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('services.ra.party.type')} error={errors.type && t('services.ra.party.entityErr')}>
          <NativeSelect value={owner.type || 'individual'} onChange={(e) => { setO('type', e.target.value); clearErr('type'); }} className={fc('type')}>
            <option value="individual">{t('services.ra.party.typeOpt.individual')}</option>
            <option value="entity">{t('services.ra.party.typeOpt.entity')}</option>
          </NativeSelect>
        </Field>
        <Field label={t('services.ra.party.residency')}>
          <NativeSelect value={owner.residency || 'resident'} onChange={(e) => { setO('residency', e.target.value); setOwnerDocs((d) => { const next = { ...d }; delete next['o-aadhaar']; delete next['o-passport']; delete next['o-visa']; return next; }); clearErr('residency'); }} className={fc('residency')}>
            {['resident', 'nri', 'foreign'].map((r) => <option key={r} value={r}>{t(`services.ra.party.residencyOpt.${r}`)}</option>)}
          </NativeSelect>
        </Field>
        {owner.type === 'entity' && (
          <div className="sm:col-span-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100 leading-relaxed">
            {t('services.ra.party.entityNote')}{' '}
            <Link to={COMMERCIAL_ROUTE} className="font-semibold text-teal-300 hover:underline">{t('services.ra.party.quoteCta')}</Link>
          </div>
        )}
        {offline && (
          <div className="sm:col-span-2 rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-xs text-sky-100 leading-relaxed">{t('services.ra.party.offlineNote')}</div>
        )}
        <Field label={t('services.ra.owner.fullName')} required error={errors.oName && t('services.ra.owner.fullNameErr')}><input value={owner.oName} onChange={(e) => { setO('oName', e.target.value); clearErr('oName'); }} className={fc('oName')} placeholder={t('services.ra.owner.fullNamePlaceholder')} /></Field>
        <PartyIdentityFields mother={owner.oMother} dob={owner.oDob} alias={owner.oAlias} age={owner.oAge} setMother={(v) => setO('oMother', v)} setDob={(v) => setO('oDob', v)} setAlias={(v) => setO('oAlias', v)} setAge={(v) => setO('oAge', v)} keys={{ mother: 'oMother', dob: 'oDob', alias: 'oAlias', age: 'oAge' }} errors={errors} clearErr={clearErr} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('services.ra.owner.age')} required error={errors.oAge && (t(errors.oAge === 'match' ? 'services.ra.err.ageDob' : 'services.ra.err.adult'))}><input inputMode="numeric" value={owner.oAge} onChange={(e) => { setO('oAge', e.target.value.replace(/\D/g, '')); clearErr('oAge'); }} className={fc('oAge')} placeholder={t('services.ra.owner.agePlaceholder')} /></Field>
          <Field label={t('services.ra.owner.gender')}><NativeSelect value={owner.oGender} onChange={(e) => setO('oGender', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm"><option value="">{t('services.ra.owner.genderPlaceholder')}</option>{['Male', 'Female', 'Other'].map((o) => <option key={o}>{o}</option>)}</NativeSelect></Field>
        </div>
        <Field label={t('services.ra.owner.pan')} required error={errors.oPan && why('oPan', 'services.ra.owner.panErr')}><input maxLength={10} value={owner.oPan} onChange={(e) => { setO('oPan', e.target.value.toUpperCase()); clearErr('oPan'); }} className={fc('oPan') + ' uppercase'} placeholder="ABCDE1234F" /></Field>
        {offline ? (
          <>
            <Field label={t('services.ra.party.passport')} required error={errors.passport && t('services.ra.party.passportErr')}><input maxLength={20} value={owner.passport || ''} onChange={(e) => { setO('passport', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); clearErr('passport'); }} className={fc('passport')} placeholder={t('services.ra.party.passportPlaceholder')} /></Field>
            {owner.residency === 'foreign' && <Field label={t('services.ra.party.visaOci')} required error={errors.visaOci && t('services.ra.party.visaOciErr')}><input maxLength={40} value={owner.visaOci || ''} onChange={(e) => { setO('visaOci', e.target.value); clearErr('visaOci'); }} className={fc('visaOci')} placeholder={t('services.ra.party.visaOciPlaceholder')} /></Field>}
            {owner.residency === 'foreign' && <Field label={t('services.ra.party.frro')}><input maxLength={40} value={owner.frro || ''} onChange={(e) => setO('frro', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.party.frroPlaceholder')} /></Field>}
          </>
        ) : (
          <Field label={t('services.ra.owner.aadhaar')} required error={errors.oAadhaar && why('oAadhaar', 'services.ra.owner.aadhaarErr')}><input inputMode="numeric" maxLength={12} value={owner.oAadhaar} onChange={(e) => { setO('oAadhaar', e.target.value.replace(/\D/g, '')); clearErr('oAadhaar'); }} className={fc('oAadhaar')} placeholder={t('services.ra.owner.aadhaarPlaceholder')} /></Field>
        )}
        <Field label={t('services.ra.owner.mobile')} required error={errors.oMobile && why('oMobile', 'services.ra.owner.mobileErr')}><MobileField value={owner.oMobile} onChange={(v) => { setO('oMobile', v); clearErr('oMobile'); }} error={!!errors.oMobile} placeholder={t('services.ra.owner.mobilePlaceholder')} inputClassName="px-4 py-3" /></Field>
        <Field label={t('services.ra.owner.email')} error={errors.oEmail && t('services.ra.err.email')}><input type="email" value={owner.oEmail} onChange={(e) => { setO('oEmail', e.target.value); clearErr('oEmail'); }} className={fc('oEmail')} placeholder="you@example.com" /></Field>
        <Field label={t('services.ra.tenant.occupation')}><input value={owner.oOccupation || ''} onChange={(e) => setO('oOccupation', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.owner.occupationPlaceholder')} /></Field>
        <Field className="sm:col-span-2" label={t('services.ra.owner.address')} required error={errors.oAddr && t('services.ra.owner.addressErr')}><textarea rows={2} value={owner.oAddr} onChange={(e) => { setO('oAddr', e.target.value); clearErr('oAddr'); }} className={fc('oAddr') + ' resize-none'} placeholder={t('services.ra.owner.addressPlaceholder')} /></Field>
        <Field className="sm:col-span-2" label={t('services.ra.owner.capacity')} error={errors.capacity && t('services.ra.owner.capacityErr')}>
          <NativeSelect value={capacities.includes(owner.capacity) ? owner.capacity : capacities[0]} onChange={(e) => { setO('capacity', e.target.value); clearErr('capacity'); }} className={fc('capacity')}>
            {capacities.map((c) => <option key={c} value={c}>{t(`services.ra.owner.capacityOpt.${c}`)}</option>)}
          </NativeSelect>
          <p className="text-gray-500 text-xs mt-1.5">{t('services.ra.owner.capacityHint')}</p>
        </Field>
        {owner.capacity === 'poa' && <PoaFields prefix="" row={owner} set={setO} errors={errors} clearErr={clearErr} fc={fc} today={today} />}
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Icon name="paperclip" className="w-4 h-4 text-teal-400" /> {t('services.ra.owner.uploadDocs')}</h3>
        <p className="text-gray-500 text-xs mb-3">{t('services.ra.owner.uploadHint')}</p>
        {vaultEnabled && (
          <p className="text-teal-300/80 text-xs mb-3 flex items-start gap-1.5"><Icon name="folder-check" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {t('services.ra.owner.vaultNote')}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ownerDocSlots(owner).map((k) => {
            const d = ownerDocs[k];
            const vaultState = !vaultEnabled || !d ? null : d.fromVault ? 'reused' : (d.dataUrl ? 'saved' : null);
            return (
              <UploadBox
                key={k}
                label={t(`services.ra.owner.doc.${k}`)}
                fileName={d?.fileName}
                preview={d}
                vaultState={vaultState}
                required
                error={errors['doc-' + k]}
                onPick={async (f) => { const nd = await pickDoc(f, d, setOwnerDocs, k); if (nd) { clearErr('doc-' + k); onDocSaved?.(k, nd, f); } }}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Icon name="users" className="w-4 h-4 text-teal-400" /> {t('services.ra.owner.coOwners.title')}</h3>
        <p className="text-gray-500 text-xs mb-3">{t('services.ra.owner.coOwners.hint')}</p>
        <div className="space-y-5">
          {coOwners.map((c, i) => (
            <CoOwnerBlock key={i} index={i} row={c} set={(k, v) => setCoOwner(i, k, v)} remove={() => removeCoOwner(i)} errors={errors} fc={fc} clearErr={clearErr} ownerDocs={ownerDocs} setOwnerDocs={setOwnerDocs} today={today} />
          ))}
        </div>
        {coOwners.length < MAX_LICENSORS - 1 && (
          <button type="button" onClick={addCoOwner} className="btn-outline mt-4 px-5 py-3 rounded-xl text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4" /> {t('services.ra.owner.coOwners.add')}</button>
        )}
      </div>
      </>
      )}
    </div>
  );
}