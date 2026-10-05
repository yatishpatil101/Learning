import { useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isoToDisplay } from '../../lib/format.js';
import DatePickerDialog from './DatePickerDialog.jsx';
/* DateField — a date input whose visible value is ALWAYS shown as DD/MM/YYYY, independent of the browser or OS
   locale. */

export default function DateField({
  id,
  value = '',
  onChange,
  className = '',
  invalid = false,
  dataErr,
  min,
  max,
  disabled = false,
  ariaLabel,
  placeholder = 'DD/MM/YYYY',
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  /* The placeholder is a format mask, not prose — DD/MM/YYYY reads the same in every language and is what the field
     literally accepts. */
  const display = isoToDisplay(value);
  const label = ariaLabel || t('ui.selectDate');

  return (
    <>
      <div
        ref={anchorRef}
        id={id}
        className={`dz-datefield ${invalid ? 'dz-invalid' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
        data-err={dataErr}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        aria-label={label}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); }
        }}
      >
        <span className={`dz-datefield__text ${!display ? 'is-placeholder' : ''}`}>
          {display || placeholder}
        </span>
        <Calendar className="dz-datefield__icon" aria-hidden="true" />
      </div>
      <DatePickerDialog
        open={open}
        value={value}
        anchorRef={anchorRef}
        min={min}
        max={max}
        ariaLabel={label}
        onClose={() => setOpen(false)}
        onConfirm={(iso) => { onChange?.(iso); setOpen(false); }}
      />
    </>
  );
}
