import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import MobileField from '../../../../components/MobileField.jsx';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import { ADDRESS_PROOF_TYPES, FAMILY_MEMBER_TYPES, FAMILY_RELATIONS, MAX_POLICE_OCCUPANTS } from './constants.js';
import { digits, pickDoc } from './helpers.js';
import UploadBox from './UploadBox.jsx';
import { addressProofUploadRequired, previousAddressProofUploadRequired, tenantDocKey, workProofRequired } from './validation.js';

const FIELD = 'field w-full px-4 py-3 rounded-xl text-white text-sm';
const BLANK_ADDRESS = { address: '', pincode: '', village: '', policeStation: '' };
const BLANK_POLICE = {
  permanentSameAsCurrent: true,
  permanent: BLANK_ADDRESS,
  addressProofType: 'uid',
  previousSameAsPermanent: true,
  previous: BLANK_ADDRESS,
  previousAddressProofType: 'uid',
  workplaceAddress: '',
  workIdProofType: '',
  occupants: [],
};
const BLANK_OCCUPANT = { type: 'family', relation: '', fullName: '', age: '', mobile: '' };
const address = (value) => ({ ...BLANK_ADDRESS, ...(value || {}) });
const record = (tenant) => ({ ...BLANK_POLICE, ...(tenant.police || {}), permanent: address(tenant.police?.permanent), previous: address(tenant.police?.previous), occupants: Array.isArray(tenant.police?.occupants) ? tenant.police.occupants : [] });

export default function TenantPoliceRecord({ tenant, index, setTenant, errors = {}, clearErr, tenantDocs = {}, setTenantDocs }) {
  const { t } = useTranslation();
  const police = record(tenant);
  const prefix = `t${index}police`;
  const workRequired = workProofRequired(tenant.occupation);
  const save = (next) => setTenant(index, 'police', next);
  const set = (key, value) => { save({ ...police, [key]: value }); clearErr(prefix + key[0].toUpperCase() + key.slice(1)); };
  const dropDoc = (slug) => setTenantDocs?.((docs) => { const next = { ...docs }; delete next[tenantDocKey(index, slug)]; return next; });
  const setProof = (key, value, slug) => {
    set(key, value);
    clearErr('doc-' + tenantDocKey(index, slug));
    if (value === 'uid') dropDoc(slug);
  };
  const setPreviousSame = (checked) => {
    set('previousSameAsPermanent', checked);
    clearErr('doc-' + tenantDocKey(index, 'prevaddressproof'));
    if (checked) dropDoc('prevaddressproof');
  };
  const setAddress = (group, key, value) => { save({ ...police, [group]: { ...police[group], [key]: value } }); clearErr(prefix + group[0].toUpperCase() + group.slice(1) + key[0].toUpperCase() + key.slice(1)); };
  const setOccupants = (rows) => save({ ...police, occupants: rows });
  const setOccupant = (row, key, value) => {
    setOccupants(police.occupants.map((item, i) => (i === row ? { ...item, [key]: value } : item)));
    clearErr(`${prefix}Occ${row}${key}`);
  };
  const option = (base, value) => t(`services.ra.tenant.police.${base}.${value}`);
  const fieldClass = (key) => FIELD + (errors[key] ? ' err' : '');
  const proofUpload = (slug) => {
    const key = tenantDocKey(index, slug);
    return <UploadBox label={t(`services.ra.tenant.doc.${slug}`)} required error={errors['doc-' + key]} fileName={tenantDocs[key]?.fileName} preview={tenantDocs[key]} onPick={async (f) => { if (await pickDoc(f, tenantDocs[key], setTenantDocs, key)) clearErr('doc-' + key); }} />;
  };
  const renderAddress = (group, required) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className={'lbl' + (required ? ' req' : '')}>{t('services.ra.tenant.police.pincode')}</label>
        <input inputMode="numeric" maxLength={6} value={police[group].pincode} onChange={(e) => setAddress(group, 'pincode', digits(e.target.value).slice(0, 6))} className={fieldClass(`${prefix}${group[0].toUpperCase() + group.slice(1)}Pincode`)} placeholder="411004" />
        <FieldError show={!!errors[`${prefix}${group[0].toUpperCase() + group.slice(1)}Pincode`]}>{t('services.ra.tenant.police.pincodeErr')}</FieldError>
      </div>
      <div>
        <label className={'lbl' + (required ? ' req' : '')}>{t('services.ra.tenant.police.village')}</label>
        <input maxLength={80} value={police[group].village} onChange={(e) => setAddress(group, 'village', e.target.value)} className={fieldClass(`${prefix}${group[0].toUpperCase() + group.slice(1)}Village`)} placeholder={t('services.ra.tenant.police.villagePlaceholder')} />
        <FieldError show={!!errors[`${prefix}${group[0].toUpperCase() + group.slice(1)}Village`]}>{t('services.ra.tenant.police.required')}</FieldError>
      </div>
      <div>
        <label className={'lbl' + (required ? ' req' : '')}>{t('services.ra.tenant.police.policeStation')}</label>
        <input maxLength={80} value={police[group].policeStation} onChange={(e) => setAddress(group, 'policeStation', e.target.value)} className={fieldClass(`${prefix}${group[0].toUpperCase() + group.slice(1)}PoliceStation`)} placeholder={t('services.ra.tenant.police.policeStationPlaceholder')} />
        <FieldError show={!!errors[`${prefix}${group[0].toUpperCase() + group.slice(1)}PoliceStation`]}>{t('services.ra.tenant.police.required')}</FieldError>
      </div>
      <div className="sm:col-span-2">
        <label className={'lbl' + (required ? ' req' : '')}>{t('services.ra.tenant.police.address')}</label>
        <textarea rows={2} maxLength={200} value={police[group].address} onChange={(e) => setAddress(group, 'address', e.target.value)} className={fieldClass(`${prefix}${group[0].toUpperCase() + group.slice(1)}Address`) + ' resize-none'} placeholder={t('services.ra.tenant.police.addressPlaceholder')} />
        <FieldError show={!!errors[`${prefix}${group[0].toUpperCase() + group.slice(1)}Address`]}>{t('services.ra.tenant.police.addressErr')}</FieldError>
      </div>
    </div>
  );

  return (
    <section className="sm:col-span-2 rounded-xl border border-white/10 p-3 sm:p-4 mt-1" data-testid={`tenant-police-record-${index}`}>
      <p className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-2"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-400" /> {t('services.ra.tenant.police.title')}</p>
      <div className="space-y-4">
        <label className="flex items-start gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={!!police.permanentSameAsCurrent} onChange={(e) => set('permanentSameAsCurrent', e.target.checked)} className="accent-teal-500 mt-0.5" />
          <span>{t('services.ra.tenant.police.permanentSame')}</span>
        </label>
        {!police.permanentSameAsCurrent && renderAddress('permanent', true)}
        <div>
          <label className="lbl req">{t('services.ra.tenant.police.addressProofType')}</label>
          <NativeSelect value={police.addressProofType || ''} title={t('services.ra.tenant.police.addressProofType')} onChange={(e) => setProof('addressProofType', e.target.value, 'addressproof')} className={fieldClass(`${prefix}AddressProofType`)}>
            {ADDRESS_PROOF_TYPES.map((value) => <option key={value} value={value}>{option('addressProofOpt', value)}</option>)}
          </NativeSelect>
          <FieldError show={!!errors[`${prefix}AddressProofType`]}>{t('services.ra.tenant.police.required')}</FieldError>
          {addressProofUploadRequired(tenant) ? proofUpload('addressproof') : <p className="mt-2 text-xs text-gray-500">{t('services.ra.tenant.police.uidProofHint')}</p>}
        </div>
        <label className="flex items-start gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={!!police.previousSameAsPermanent} onChange={(e) => setPreviousSame(e.target.checked)} className="accent-teal-500 mt-0.5" />
          <span>{t('services.ra.tenant.police.previousSame')}</span>
        </label>
        {!police.previousSameAsPermanent && (
          <>
            {renderAddress('previous', true)}
            <div>
              <label className="lbl req">{t('services.ra.tenant.police.previousAddressProofType')}</label>
              <NativeSelect value={police.previousAddressProofType || ''} title={t('services.ra.tenant.police.previousAddressProofType')} onChange={(e) => setProof('previousAddressProofType', e.target.value, 'prevaddressproof')} className={fieldClass(`${prefix}PreviousAddressProofType`)}>
                {ADDRESS_PROOF_TYPES.map((value) => <option key={value} value={value}>{option('addressProofOpt', value)}</option>)}
              </NativeSelect>
              <FieldError show={!!errors[`${prefix}PreviousAddressProofType`]}>{t('services.ra.tenant.police.required')}</FieldError>
              {previousAddressProofUploadRequired(tenant) ? proofUpload('prevaddressproof') : <p className="mt-2 text-xs text-gray-500">{t('services.ra.tenant.police.uidProofHint')}</p>}
            </div>
          </>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={'lbl' + (workRequired ? ' req' : '')}>{t('services.ra.tenant.police.workplaceAddress')}</label>
            <textarea rows={2} maxLength={200} value={police.workplaceAddress || ''} onChange={(e) => set('workplaceAddress', e.target.value)} className={fieldClass(`${prefix}WorkplaceAddress`) + ' resize-none'} placeholder={t('services.ra.tenant.police.workplacePlaceholder')} />
            <FieldError show={!!errors[`${prefix}WorkplaceAddress`]}>{t('services.ra.tenant.police.workplaceErr')}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <label className={'lbl' + (workRequired ? ' req' : '')}>{t('services.ra.tenant.police.workIdProofType')}</label>
            <input maxLength={80} value={police.workIdProofType || ''} onChange={(e) => set('workIdProofType', e.target.value)} className={fieldClass(`${prefix}WorkIdProofType`)} placeholder={t('services.ra.tenant.police.workIdPlaceholder')} />
            <FieldError show={!!errors[`${prefix}WorkIdProofType`]}>{t('services.ra.tenant.police.required')}</FieldError>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="lbl">{t('services.ra.tenant.police.occupants')}</p>
            {police.occupants.length < MAX_POLICE_OCCUPANTS && <button type="button" onClick={() => setOccupants([...police.occupants, BLANK_OCCUPANT])} className="btn-outline px-3 py-2 rounded-xl text-teal-400 text-xs font-semibold flex items-center gap-1"><Icon name="plus-circle" className="w-3.5 h-3.5" /> {t('services.ra.tenant.police.addOccupant')}</button>}
          </div>
          <div className="space-y-3">
            {police.occupants.map((row, rowIndex) => (
              <div key={rowIndex} className="rounded-xl border border-white/10 p-3" data-testid={`tenant-police-occupant-${index}-${rowIndex}`}>
                <div className="flex items-end gap-2 mb-3">
                  <div className="flex-1">
                    <label className="lbl">{t('services.ra.tenant.police.occupantType')}</label>
                    <NativeSelect value={row.type || 'family'} title={t('services.ra.tenant.police.occupantType')} onChange={(e) => setOccupant(rowIndex, 'type', e.target.value)} className={FIELD}>
                      {FAMILY_MEMBER_TYPES.map((value) => <option key={value} value={value}>{option('occupantTypeOpt', value)}</option>)}
                    </NativeSelect>
                  </div>
                  <button type="button" onClick={() => setOccupants(police.occupants.filter((_, i) => i !== rowIndex))} className="p-3 rounded-xl text-gray-400 hover:text-red-400" title={t('services.ra.tenant.police.removeOccupant')} aria-label={t('services.ra.tenant.police.removeOccupant')}><Icon name="x" className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="lbl req">{t('services.ra.tenant.police.fullName')}</label><input maxLength={80} value={row.fullName || ''} onChange={(e) => setOccupant(rowIndex, 'fullName', e.target.value)} className={fieldClass(`${prefix}Occ${rowIndex}fullName`)} /><FieldError show={!!errors[`${prefix}Occ${rowIndex}fullName`]}>{t('services.ra.tenant.police.nameErr')}</FieldError></div>
                  <div>
                    <label className="lbl req">{t('services.ra.tenant.police.relation')}</label>
                    <NativeSelect value={row.relation || ''} title={t('services.ra.tenant.police.relation')} onChange={(e) => setOccupant(rowIndex, 'relation', e.target.value)} className={fieldClass(`${prefix}Occ${rowIndex}relation`)}>
                      <option value="">{t('services.ra.tenant.police.selectRelation')}</option>
                      {FAMILY_RELATIONS.map((value) => <option key={value} value={value}>{option('relationOpt', value)}</option>)}
                    </NativeSelect>
                    <FieldError show={!!errors[`${prefix}Occ${rowIndex}relation`]}>{t('services.ra.tenant.police.required')}</FieldError>
                  </div>
                  <div><label className="lbl req">{t('services.ra.tenant.police.age')}</label><input inputMode="numeric" maxLength={3} value={row.age || ''} onChange={(e) => setOccupant(rowIndex, 'age', digits(e.target.value).slice(0, 3))} className={fieldClass(`${prefix}Occ${rowIndex}age`)} placeholder="35" /><FieldError show={!!errors[`${prefix}Occ${rowIndex}age`]}>{t('services.ra.tenant.police.ageErr')}</FieldError></div>
                  <div><label className="lbl req">{t('services.ra.tenant.police.mobile')}</label><MobileField value={row.mobile || ''} onChange={(v) => setOccupant(rowIndex, 'mobile', v)} error={!!errors[`${prefix}Occ${rowIndex}mobile`]} placeholder={t('services.ra.tenant.mobilePlaceholder')} inputClassName="px-4 py-3" /><FieldError show={!!errors[`${prefix}Occ${rowIndex}mobile`]}>{t('services.ra.tenant.mobileErr')}</FieldError></div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">{t('services.ra.tenant.police.occupantsHint')}</p>
        </div>
      </div>
    </section>
  );
}
