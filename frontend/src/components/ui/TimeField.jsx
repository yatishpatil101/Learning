import { useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { displayTime } from '../../lib/timeOfDay.js';
import TimePickerDialog from './TimePickerDialog.jsx';

/**
 * TimeField — a time input that opens the app's custom time picker
 * (TimePickerDialog) instead of the unstylable OS-native time popup, mirroring
 * DateField. Shows the selected time as text and stores it in the requested
 * `format` ('12h' → "10:30 AM", '24h' → "22:00") so call sites stay unchanged.
 *
 * @param {object} props
 * @param {string} props.value - Time string ("10:30 AM" or "22:00") or ''.
 * @param {(value: string) => void} props.onChange
 * @param {'12h'|'24h'} [props.format='12h']
 * @param {number} [props.minuteStep=5]
 * @param {string} [props.className]
 * @param {boolean} [props.invalid]
 * @param {string} [props.dataErr]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]
 * @param {string} [props.placeholder='Select time']
 */
export default function TimeField({
  value = '',
  onChange,
  format = '12h',
  minuteStep = 5,
  className = '',
  invalid = false,
  dataErr,
  disabled = false,
  ariaLabel,
  placeholder = 'Select time',
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const display = displayTime(value, format);
  const label = ariaLabel || placeholder;

  return (
    <>
      <div
        ref={anchorRef}
        className={`pn-datefield ${invalid ? 'pn-invalid' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
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
        <span className={`pn-datefield__text ${!display ? 'is-placeholder' : ''}`}>
          {display || placeholder}
        </span>
        <Clock className="pn-datefield__icon" aria-hidden="true" />
      </div>
      <TimePickerDialog
        open={open}
        value={value}
        anchorRef={anchorRef}
        format={format}
        minuteStep={minuteStep}
        ariaLabel={label}
        onClose={() => setOpen(false)}
        onConfirm={(v) => { onChange?.(v); setOpen(false); }}
      />
    </>
  );
}
