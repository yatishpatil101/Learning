import { useTranslation } from 'react-i18next';
import DateField from '../../../../components/ui/DateField.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
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
      <div><label className="lbl req">{t('services.ra.party.mother')}</label><input maxLength={80} value={mother || ''} onChange={(e) => { setMother(e.target.value); clear(keys.mother); }} className={cls(keys.mother)} placeholder={t('services.ra.party.motherPlaceholder')} /><FieldError show={!!err(keys.mother)}>{t('services.ra.party.motherErr')}</FieldError></div>
      <div>
        <label className="lbl req">{t('services.ra.party.dob')}</label>
        <DateField value={dob || ''} min={dobMin} max={today} onChange={onDob} className={cls(keys.dob)} invalid={!!err(keys.dob)} dataErr={keys.dob} ariaLabel={t('services.ra.party.dob')} />
        <FieldError show={!!err(keys.dob)}>{t('services.ra.party.dobErr')}</FieldError>
      </div>
      <div><label className="lbl">{t('services.ra.party.alias')}</label><input maxLength={80} value={alias || ''} onChange={(e) => { setAlias(e.target.value); clear(keys.alias); }} className={cls(keys.alias)} placeholder={t('services.ra.party.aliasPlaceholder')} /><FieldError show={!!err(keys.alias)}>{t('services.ra.party.aliasErr')}</FieldError></div>
    </>
  );
}
