import { useState } from 'react';

// Shared mobile-number input:
//   [ 🇮🇳 +91 ] [ 98765 43210 ]
// Two visually separate boxes with tight 6px gap so they read as one unit.
// Strips non-digits, caps at 10, enforces an Indian mobile (starts 6-9),
// and shows error state on blur when value is invalid.
const IN_PATTERN = /^[6-9]\d{9}$/;
const sanitize = (v) => String(v == null ? '' : v).replace(/\D/g, '').slice(0, 10);

export const isValidMobile = (v) => IN_PATTERN.test(sanitize(v));

export default function MobileField({
  value,
  onChange,
  placeholder = 'Enter mobile number',
  inputClassName = '',
  className = '',
  error = false,
  disabled = false,
  id,
  autoFocus = false,
  enterKeyHint = 'next',
}) {
  const [touched, setTouched] = useState(false);
  const clean = sanitize(value);
  const bad = error || (touched && clean.length > 0 && !IN_PATTERN.test(clean));

  const borderCls = bad
    ? 'border-rose-400/70'
    : 'border-white/10';
  const focusCls = bad
    ? 'ring-2 ring-rose-400/20'
    : '';

  return (
    <div className={'flex items-center gap-1.5 w-full ' + className}>
      {/* Country code chip */}
      <span
        className={
          'inline-flex items-center gap-1.5 h-11 sm:h-10 px-3.5 rounded-xl border bg-white/5 text-sm font-medium text-gray-300 select-none whitespace-nowrap flex-shrink-0 '
          + borderCls
        }
      >
        <span className="text-base leading-none">🇮🇳</span>
        <span className="text-gray-400">+91</span>
      </span>

      {/* Number input */}
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        maxLength={10}
        autoComplete="tel-national"
        // A phone number is almost never the last field in these forms, so the
        // keyboard's action key should move the user on rather than say "return".
        enterKeyHint={enterKeyHint}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        disabled={disabled}
        value={clean}
        onChange={(e) => onChange(sanitize(e.target.value))}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        className={
          'flex-1 min-w-0 h-11 sm:h-10 px-4 rounded-xl border bg-white/5 text-white text-sm placeholder-gray-500 outline-none transition-colors '
          + borderCls + ' ' + focusCls
          + ' focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20'
          + (disabled ? ' opacity-50 cursor-not-allowed' : '')
          + (inputClassName ? ' ' + inputClassName : '')
        }
      />
    </div>
  );
}
