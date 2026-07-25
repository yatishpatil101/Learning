import { forwardRef, useId, useState } from 'react';

/** Strip formatting and read a number, understanding ₹, commas and Cr/L/K suffixes. */
function defaultParse(str) {
  const s = String(str).toLowerCase().replace(/[₹,\s+]/g, '');
  if (!s) return null;
  const m = s.match(/^(-?\d*\.?\d+)(cr|crore|l|lakh|lac|k)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = m[2];
  if (unit === 'cr' || unit === 'crore') n *= 1e7;
  else if (unit === 'l' || unit === 'lakh' || unit === 'lac') n *= 1e5;
  else if (unit === 'k') n *= 1e3;
  return n;
}

/**
 * Dual-range slider for min/max selection (budget, area, age, etc.).
 * Values can be set by dragging a thumb OR by clicking a value label and typing.
 * @param {object} props
 * @param {number} props.min - Minimum range value.
 * @param {number} props.max - Maximum range value.
 * @param {number} [props.step=1] - Step increment.
 * @param {[number, number]} props.value - Current [low, high] values.
 * @param {(value: [number, number]) => void} props.onChange - Callback with new [low, high].
 * @param {(value: number) => string} [props.format] - Formatter for display values.
 * @param {(text: string) => number|null} [props.parse] - Parse an edited string back to a number (null = ignore).
 * @param {string} [props.label] - Descriptive label for accessibility (prefixed to aria-label).
 * @param {boolean} [props.disabled] - Disable interaction.
 */
const DualRange = forwardRef(function DualRange({ min, max, step = 1, value, onChange, format = (v) => v, parse = defaultParse, label = '', disabled = false }, ref) {
  const [lo, hi] = value;
  const id = useId();
  const [editing, setEditing] = useState(null); // 'lo' | 'hi' | null
  const [draft, setDraft] = useState('');
  // Manual entry may push a bound past the visual max — commercial rents and
  // large-plot areas routinely exceed a residential-friendly ceiling. The track
  // then grows to include the typed value so both thumbs stay meaningful and
  // draggable, while the slider ends still read as "and above" (the "+").
  const sMin = Math.min(min, lo);
  const sMax = Math.max(max, hi);
  const pct = (v) => Math.min(100, Math.max(0, ((v - sMin) / (sMax - sMin || 1)) * 100));
  const snap = (v, lowBound, highBound) => {
    const clamped = Math.min(Math.max(v, lowBound), highBound);
    const stepped = Math.round((clamped - min) / step) * step + min;
    return Math.min(Math.max(stepped, lowBound), highBound);
  };

  // Dragging is bounded by the (possibly grown) track; typed entry may exceed the
  // visual max entirely (highBound = the typed value's own ceiling).
  const setLo = (v) => onChange([snap(Number(v), min, hi), hi]);
  const setHi = (v) => onChange([lo, snap(Number(v), lo, Math.max(max, Number(v)))]);

  const openEdit = (which) => {
    if (disabled) return;
    setDraft(String(format(which === 'lo' ? lo : hi)).replace(/\+$/, ''));
    setEditing(which);
  };
  const commitEdit = (which) => {
    const n = parse(draft);
    if (n != null && !Number.isNaN(n)) (which === 'lo' ? setLo : setHi)(n);
    setEditing(null);
  };
  const onKeyDown = (which, e) => {
    if (e.key === 'Enter') commitEdit(which);
    else if (e.key === 'Escape') setEditing(null);
  };

  const valueClass = 'rng-val text-teal-300 font-semibold underline decoration-dotted decoration-teal-400/40 underline-offset-4 hover:decoration-teal-300 focus:outline-none focus:decoration-teal-300 cursor-text';
  const inputClass = 'w-24 bg-white/10 border border-teal-400/50 rounded px-1.5 py-0.5 text-teal-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400';

  const renderValue = (which, v, align) => (editing === which ? (
    <input
      type="text"
      inputMode="numeric"
      autoFocus
      value={draft}
      aria-label={label ? `${label} ${which === 'lo' ? 'minimum' : 'maximum'} value` : which === 'lo' ? 'Minimum value' : 'Maximum value'}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => commitEdit(which)}
      onKeyDown={(e) => onKeyDown(which, e)}
      className={`${inputClass}${align === 'right' ? ' text-right' : ''}`}
    />
  ) : (
    <button
      type="button"
      className={`rng-${which} ${valueClass}`}
      onClick={() => openEdit(which)}
      title="Click to enter a value"
      aria-label={label ? `${label} ${which === 'lo' ? 'minimum' : 'maximum'}: ${format(v)}. Click to edit` : undefined}
    >
      {format(v)}
    </button>
  ));

  return (
    <div className={'rng-wrap' + (disabled ? ' opacity-50 pointer-events-none' : '')} ref={ref}>
      <div className="rng">
        <div className="rng-track">
          <div className="rng-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        </div>
        <input type="range" aria-label={label ? `${label} minimum` : 'Minimum'} min={sMin} max={sMax} step={step} value={lo} onChange={(e) => setLo(e.target.value)} id={`${id}-lo`} />
        <input type="range" aria-label={label ? `${label} maximum` : 'Maximum'} min={sMin} max={sMax} step={step} value={hi} onChange={(e) => setHi(e.target.value)} id={`${id}-hi`} />
      </div>
      <div className="flex justify-between mt-3 text-xs">
        {renderValue('lo', lo, 'left')}
        {renderValue('hi', hi, 'right')}
      </div>
    </div>
  );
});

export default DualRange;
