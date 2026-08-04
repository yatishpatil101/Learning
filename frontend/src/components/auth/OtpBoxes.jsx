import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/* 6-box OTP input (ports the .otp-box flow from signin/signup.html):
   auto-advance, backspace to previous, paste-to-fill. Controlled via `value`. */
export default function OtpBoxes({ value = '', onChange, error }) {
  const { t } = useTranslation();
  const refs = useRef([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const setChar = (idx, ch) => {
    const arr = value.split('');
    arr[idx] = ch;
    const next = arr.join('').slice(0, 6);
    onChange(next);
    if (ch && idx < 5) refs.current[idx + 1]?.focus();
  };

  // Handle single-key typing plus multi-digit input (iOS/Android SMS autofill
  // dumps the whole code into one box, and some IMEs deliver several digits).
  const onInput = (idx, raw) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length > 1) {
      const next = (value.slice(0, idx) + digits).slice(0, 6);
      onChange(next);
      refs.current[Math.min(next.length, 5)]?.focus();
      return;
    }
    setChar(idx, digits.slice(-1));
  };

  const onKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !value[idx] && idx > 0) {
      e.preventDefault();
      const arr = value.split('');
      arr[idx - 1] = '';
      onChange(arr.join(''));
      refs.current[idx - 1]?.focus();
    }
  };

  const onPaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="otp-container">
      {Array.from({ length: 6 }).map((_, i) => {
        const ch = value[i] || '';
        const cls = 'otp-box' + (ch ? ' filled' : '') + (error && !ch ? ' error-otp' : '');
        return (
          <input
            key={i}
            ref={(el) => (refs.current[i] = el)}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={ch}
            onChange={(e) => onInput(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            className={cls}
              aria-label={t('auth2.otpDigit', { n: i + 1 })}
          />
        );
      })}
    </div>
  );
}
