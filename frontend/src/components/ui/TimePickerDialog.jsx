import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Select from './Select.jsx';
import { parseTime, formatTime, to12h, HOUR_OPTIONS, minuteOptions } from '../../lib/timeOfDay.js';

/**
 * TimePickerDialog — the app-wide custom time selector, styled to match
 * DatePickerDialog (same portaled card, teal accents, Confirm button). Instead of
 * a fixed slot list it lets the user pick any hour/minute/meridiem, so a single
 * control works for visit times and any other "time of day" field. Caller commits
 * on Confirm; the emitted string honours `format` ('12h' → "10:30 AM", '24h' → "22:00").
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.value - Current value ("10:30 AM" or "22:00") or ''.
 * @param {React.RefObject} props.anchorRef - The field element to anchor under.
 * @param {'12h'|'24h'} [props.format='12h'] - Output/display convention.
 * @param {number} [props.minuteStep=5] - Minute granularity.
 * @param {() => void} props.onClose
 * @param {(value: string) => void} props.onConfirm
 * @param {string} [props.ariaLabel] - Defaults to the translated "Select time".
 */
export default function TimePickerDialog({ open, value, anchorRef, format = '12h', minuteStep = 5, onClose, onConfirm, ariaLabel }) {
  const { t } = useTranslation();
  const dialogLabel = ariaLabel || t('ui.selectTime');
  const panelRef = useRef(null);
  const seed = parseTime(value) || { h24: 10, min: 0 };
  const [draft, setDraft] = useState(seed);
  const [shown, setShown] = useState(false);

  // Re-seed each time the panel opens so it reflects the latest committed value.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    setDraft(parseTime(value) || { h24: 10, min: 0 });
  }, [open, value]);

  const mer = draft.h24 >= 12 ? 'PM' : 'AM';
  const hour12 = draft.h24 % 12 || 12;

  const setHour12 = (h12) => setDraft((d) => {
    const isPm = d.h24 >= 12;
    let h = h12 % 12;
    if (isPm) h += 12;
    return { ...d, h24: h };
  });
  const setMinute = (m) => setDraft((d) => ({ ...d, min: m }));
  const setMeridiem = (m) => setDraft((d) => {
    const base = d.h24 % 12;
    return { ...d, h24: m === 'PM' ? base + 12 : base };
  });

  // Anchor the panel under the field with fixed positioning; flip up near the
  // viewport bottom and clamp horizontally so it never overflows the screen.
  const place = useCallback(() => {
    const anchor = anchorRef?.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    // Mirrors DatePickerDialog: below 640px the shared `.dz-cal` rules dock this
    // panel as a bottom sheet, so anchoring must stand down and clear itself.
    if (window.matchMedia('(max-width: 639.98px)').matches) {
      panel.style.left = '';
      panel.style.top = '';
      return;
    }
    const r = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8 && r.top - 8 - ph > 8) top = r.top - 8 - ph;
    top = Math.min(top, window.innerHeight - 8 - ph);
    top = Math.max(8, top);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const raf = requestAnimationFrame(() => setShown(true));
    const onAnchor = () => place();
    window.addEventListener('scroll', onAnchor, true);
    window.addEventListener('resize', onAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onAnchor, true);
      window.removeEventListener('resize', onAnchor);
    };
  }, [open, place]);

  // Close on outside interaction — but ignore clicks inside the panel, the field
  // that opened it, and any portaled <Select> menu (the hour/minute dropdowns).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      if (t.closest?.('.dz-dropdown__menu, .dz-dropdown')) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, anchorRef, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.dz-dropdown.is-open')) return; // let an open Select close first
        e.preventDefault(); onClose?.(); return;
      }
      if (e.key === 'Enter') { e.preventDefault(); onConfirm?.(formatTime(draft, format)); }
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, draft, format, onClose, onConfirm]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={dialogLabel}
      className={`dz-cal dz-timepicker${shown ? ' is-open' : ''}`}
    >
      <div className="dz-cal__head">
        <h3 className="dz-cal__title">{t('ui.selectTimeTitle')}</h3>
        <span className="dz-timepicker__readout" aria-hidden="true">{to12h(draft)}</span>
      </div>

      <div className="dz-timepicker__row">
        <Select
          className="dz-cal__dd dz-timepicker__unit"
          value={String(hour12)}
          options={HOUR_OPTIONS}
          searchable={false}
          ariaLabel={t('ui.hour')}
          onChange={(v) => setHour12(+v)}
        />
        <span className="dz-timepicker__colon" aria-hidden="true">:</span>
        <Select
          className="dz-cal__dd dz-timepicker__unit"
          value={String(draft.min - (draft.min % minuteStep))}
          options={minuteOptions(minuteStep)}
          searchable={false}
          ariaLabel={t('ui.minute')}
          onChange={(v) => setMinute(+v)}
        />
        <div className="dz-timepicker__mer" role="group" aria-label={t('ui.amOrPm')}>
          {['AM', 'PM'].map((m) => (
            <button
              key={m}
              type="button"
              className={mer === m ? 'is-on' : ''}
              aria-pressed={mer === m}
              onClick={() => setMeridiem(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="dz-cal__confirm" onClick={() => onConfirm?.(formatTime(draft, format))}>
        {t('ui.confirm')}
      </button>
    </div>,
    document.body,
  );
}
