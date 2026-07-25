/* Time-of-day parsing/formatting — the counterpart to lib/format.js date helpers.
   Keeps the app's time vocabulary in one place so the shared TimePicker can read
   and write both 12-hour visit strings ("10:30 AM") and 24-hour settings values
   ("22:00") without every call site re-implementing the conversion. */

const pad2 = (n) => String(n).padStart(2, '0');

// Parse "10:30 AM" or "22:00" into { h24, min }. Returns null for empty/invalid.
export function parseTime(str) {
  const s = String(str || '').trim();
  const m12 = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(s);
  if (m12) {
    let h = +m12[1] % 12;
    if (/p/i.test(m12[3])) h += 12;
    return { h24: h, min: +m12[2] };
  }
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m24 && +m24[1] < 24 && +m24[2] < 60) return { h24: +m24[1], min: +m24[2] };
  return null;
}

export function to12h({ h24, min }) {
  const mer = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  return `${h}:${pad2(min)} ${mer}`;
}

export function to24h({ h24, min }) {
  return `${pad2(h24)}:${pad2(min)}`;
}

// Format a { h24, min } for the requested display/storage convention.
export function formatTime(t, fmt = '12h') {
  return fmt === '24h' ? to24h(t) : to12h(t);
}

// Show any stored value ("22:00" or "10:30 PM") the way `fmt` wants it, or '' if blank.
export function displayTime(value, fmt = '12h') {
  const t = parseTime(value);
  return t ? formatTime(t, fmt) : '';
}

export const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

// Minute options at a given granularity (default 5 min → 12 options).
export function minuteOptions(step = 5) {
  const out = [];
  for (let m = 0; m < 60; m += step) out.push({ value: String(m), label: pad2(m) });
  return out;
}
