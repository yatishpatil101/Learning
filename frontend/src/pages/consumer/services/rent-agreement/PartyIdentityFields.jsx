import { useTranslation } from 'react-i18next';
import DateField from '../../../../components/ui/DateField.jsx';
import Field from '../../../../components/ui/Field.jsx';
import { ageFromDob, todayIst } from './validation.js';

const FIELD = 'field w-full px-4 py-3 rounded-xl text-white text-sm';
const dobMin = '1900-01-01';

export default function PartyIdentityFields({ mother, dob, alias, setMother, setDob, setAlias, setAge, keys, errors, clearErr }) {
  const { t } = useTranslation();
  const today = todayIst();
  const err = (key) => errors[key];
  const cls = (key) => FIELD + (err(key) ? ' err' : '');
  const clear = (key) => clearErr?.(key);
  const onDob = (value) => {
    setDob(value);
    setAge(ageFromDob(value, today));
    clear(keys.dob);
    clear(keys.age);
  };

  return (
    <>
      <Field label={t('services.ra.party.mother')} required error={err(keys.mother) && t('services.ra.party.motherErr')}><input maxLength={80} value={mother || ''} onChange={(e) => { setMother(e.target.value); clear(keys.mother); }} className={cls(keys.mother)} placeholder={t('services.ra.party.motherPlaceholder')} /></Field>
      <Field label={t('services.ra.party.dob')} required error={err(keys.dob) && t('services.ra.party.dobErr')}>
        <DateField value={dob || ''} min={dobMin} max={today} onChange={onDob} className={cls(keys.dob)} invalid={!!err(keys.dob)} dataErr={keys.dob} ariaLabel={t('services.ra.party.dob')} />
      </Field>
      <Field label={t('services.ra.party.alias')} error={err(keys.alias) && t('services.ra.party.aliasErr')}><input maxLength={80} value={alias || ''} onChange={(e) => { setAlias(e.target.value); clear(keys.alias); }} className={cls(keys.alias)} placeholder={t('services.ra.party.aliasPlaceholder')} /></Field>
    </>
  );
}
