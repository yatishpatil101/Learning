import { useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isoToDisplay } from '../../lib/format.js';
import DatePickerDialog from './DatePickerDialog.jsx';

/**
 * DateField — a date input whose visible value is ALWAYS shown as DD/MM/YYYY,
 * independent of the browser or OS locale. Clicking it opens the app's custom
 * calendar (DatePickerDialog) — a single, centrally-controlled picker used
 * everywhere — instead of the unstylable OS-native date popup. The stored value
 * stays ISO (yyyy-mm-dd), so every call site keeps working unchanged downstream.
 *
 * @param {object} props
 * @param {string} props.value - ISO date (yyyy-mm-dd) or ''.
 * @param {(iso: string) => void} props.onChange - Called with the ISO value.
 * @param {string} [props.className] - Classes for the field box (match siblings).
 * @param {boolean} [props.invalid] - Adds error styling.
 * @param {string} [props.dataErr] - data-err key for scroll-to-error binding.
 * @param {string} [props.min] - Optional ISO lower bound.
 * @param {string} [props.max] - Optional ISO upper bound.
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 * @param {string} [props.placeholder='DD/MM/YYYY']
 */
export default function DateField({
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
  const display = isoToDisplay(value);
  /* The placeholder is a format mask, not prose — DD/MM/YYYY reads the same in
     every language and is what the field literally accepts. Only the accessible
     name is translated, since a screen reader announces it as a sentence. */
  const label = ariaLabel || t('ui.selectDate');

  return (
    <>
      <div
        ref={anchorRef}
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
