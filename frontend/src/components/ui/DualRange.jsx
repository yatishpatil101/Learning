import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommitOnRelease } from '../../lib/useCommitOnRelease.js';

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
 * Dual-range slider for min/max selection (budget, area, age). Drag a thumb or type into a label.
 * @param {object} props
 * @param {number} props.min - Minimum range value.
 * @param {number} props.max - Maximum range value.
 * @param {number} [props.step=1] - Step increment.
 * @param {[number, number]} props.value - Current [low, high] values.
 * @param {(value: [number, number]) => void} props.onChange - Fires once a drag has settled or a
 *   typed figure is committed, so each call is one user intent (see `useCommitOnRelease`).
 * @param {(value: number) => string} [props.format] - Formatter for display values.
 * @param {(text: string) => number|null} [props.parse] - Parse an edited string back to a number (null = ignore).
 * @param {string} [props.label] - Descriptive label for accessibility (prefixed to aria-label).
 * @param {boolean} [props.disabled] - Disable interaction.
 */
const DualRange = forwardRef(function DualRange({ min, max, step = 1, value, onChange, format = (v) => v, parse = defaultParse, label = '', disabled = false }, ref) {
  const { t } = useTranslation();
  const id = useId();
  const [editing, setEditing] = useState(null); // 'lo' | 'hi' | null
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const rangeRef = useRef(null);
  const thumbDragRef = useRef(null);
  const thumbLiveRef = useRef(null);

  /* A drag is one intent, not eighty: `useCommitOnRelease` holds the in-flight tuple and lifts it
     to `onChange` only once the value settles. Everything below reads the live tuple. */
  const [[lo, hi], setLive, commitProps] = useCommitOnRelease(value, onChange);

  // Manual entry may push a bound past the visual max (commercial rents, large plots), so the
  // track grows to include the typed value and both thumbs stay draggable.
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
  const nextLo = (v) => [snap(Number(v), min, hi), hi];
  const nextHi = (v) => [lo, snap(Number(v), lo, Math.max(max, Number(v)))];
  const valueFromClientX = (clientX) => {
    const box = rangeRef.current?.getBoundingClientRect();
    if (!box?.width) return min;
    return sMin + ((clientX - box.left) / box.width) * (sMax - sMin);
  };
  const updateThumb = (which, clientX) => {
    const next = which === 'lo' ? nextLo(valueFromClientX(clientX)) : nextHi(valueFromClientX(clientX));
    thumbLiveRef.current = next;
    setLive(next);
  };
  const onThumbPointerDown = (which, e) => {
    if (disabled) return;
    e.preventDefault();
    thumbDragRef.current = which;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updateThumb(which, e.clientX);
  };
  const onThumbPointerMove = (e) => {
    if (!thumbDragRef.current) return;
    updateThumb(thumbDragRef.current, e.clientX);
  };
  const onThumbPointerEnd = (e) => {
    if (!thumbDragRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    thumbDragRef.current = null;
    if (thumbLiveRef.current) onChange(thumbLiveRef.current);
    thumbLiveRef.current = null;
  };

  const openEdit = (which) => {
    if (disabled) return;
    setDraft(String(format(which === 'lo' ? lo : hi)).replace(/\+$/, ''));
    setEditing(which);
  };
  const commitEdit = (which) => {
    const n = parse(draft);
    /* Straight to the owner, bypassing the hold-until-settled path the thumbs use: typing a
       figure is already one deliberate act, with no intermediate values to collapse. */
    if (n != null && !Number.isNaN(n)) onChange(which === 'lo' ? nextLo(n) : nextHi(n));
    setEditing(null);
  };
  const onKeyDown = (which, e) => {
    if (e.key === 'Enter') commitEdit(which);
    else if (e.key === 'Escape') setEditing(null);
  };

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const valueClass = 'rng-val text-teal-300 font-semibold underline decoration-dotted decoration-teal-400/40 underline-offset-4 focus:outline-none focus:decoration-teal-300 cursor-text';
  const inputClass = 'w-24 bg-white/10 border border-teal-400/50 rounded px-1.5 py-0.5 text-base sm:text-sm text-teal-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400';

  const renderValue = (which, v, align) => (editing === which ? (
    <input
      type="text"
      inputMode="text"
      ref={inputRef}
      enterKeyHint="done"
      autoCapitalize="off"
      autoCorrect="off"
      value={draft}
      aria-label={label
        ? t(which === 'lo' ? 'ui.minValueInput' : 'ui.maxValueInput', { label })
        : t(which === 'lo' ? 'ui.minValuePlain' : 'ui.maxValuePlain')}
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
      title={t('ui.clickToEnter')}
      aria-label={label ? t(which === 'lo' ? 'ui.minValueEdit' : 'ui.maxValueEdit', { label, value: format(v) }) : undefined}
    >
      {format(v)}
    </button>
  ));

  return (
    <div className={'rng-wrap' + (disabled ? ' opacity-50 pointer-events-none' : '')} ref={ref}>
      <div className="rng" ref={rangeRef}>
        <div className="rng-track">
          <div className="rng-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        </div>
        <input type="range" aria-label={label ? t('ui.minValueOf', { label }) : t('ui.minimum')} min={sMin} max={sMax} step={step} value={lo} onChange={(e) => setLive(nextLo(e.target.value))} {...commitProps} id={`${id}-lo`} />
        <input type="range" aria-label={label ? t('ui.maxValueOf', { label }) : t('ui.maximum')} min={sMin} max={sMax} step={step} value={hi} onChange={(e) => setLive(nextHi(e.target.value))} {...commitProps} id={`${id}-hi`} />
        <div className="rng-thumb-hit" aria-hidden="true" style={{ left: `${pct(lo)}%` }} onPointerDown={(e) => onThumbPointerDown('lo', e)} onPointerMove={onThumbPointerMove} onPointerUp={onThumbPointerEnd} onPointerCancel={onThumbPointerEnd} />
        <div className="rng-thumb-hit" aria-hidden="true" style={{ left: `${pct(hi)}%` }} onPointerDown={(e) => onThumbPointerDown('hi', e)} onPointerMove={onThumbPointerMove} onPointerUp={onThumbPointerEnd} onPointerCancel={onThumbPointerEnd} />
      </div>
      <div className="flex justify-between mt-3 text-xs">
        {renderValue('lo', lo, 'left')}
        {renderValue('hi', hi, 'right')}
      </div>
    </div>
  );
});

export default DualRange;
