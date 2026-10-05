import { useTranslation } from 'react-i18next';
import DateField from '../../../components/ui/DateField.jsx';
import { segClass, isDateVal, todayIso } from './helpers.js';

export default function MoveInField({ value, onChange, label }) {
  const { t } = useTranslation();
  const chip = (v, text) => (
    <button type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={segClass(value === v) + ' shrink-0'}>{text}</button>
  );
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2" data-testid="move-in-field">
      {chip('now', t('flatmates.immediate'))}
      {chip('', t('flatmates.flexible'))}
      <DateField
        value={isDateVal(value) ? value : ''}
        min={todayIso()}
        onChange={onChange}
        className="field rounded-full px-4 h-10 text-sm flex-1 min-w-[9rem]"
        ariaLabel={t('flatmates.ariaMoveInDate')}
        placeholder={t('flatmates.byDate')}
      />
    </div>
  );
}
