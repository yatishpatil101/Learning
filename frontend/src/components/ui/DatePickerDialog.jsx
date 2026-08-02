import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Select from './Select.jsx';

/* ── Date helpers (timezone-safe: work in yyyy-mm-dd strings, never Date parsing) ── */
const pad = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based
const parseIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const todayIso = () => {
  const t = new Date();
  return toIso(t.getFullYear(), t.getMonth(), t.getDate());
};
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const firstWeekday = (y, m) => new Date(y, m, 1).getDay(); // 0 = Sun
const addMonths = (y, m, delta) => {
  const total = y * 12 + m + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
};

const MONTH_COUNT = 12;

/**
 * DatePickerDialog — the app-wide custom calendar, shown as a dropdown anchored
 * below its field (portaled to <body>, no page backdrop). Light "Select Date"
 * card with teal accents; month/year use the shared <Select> so they match the
 * app's dropdown theme. Selecting a day commits immediately (no Confirm button).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.value - Current ISO value (yyyy-mm-dd) or ''.
 * @param {React.RefObject} props.anchorRef - The field element to anchor under.
 * @param {string} [props.min] - ISO lower bound (inclusive).
 * @param {string} [props.max] - ISO upper bound (inclusive).
 * @param {() => void} props.onClose - Dismiss without committing.
 * @param {(iso: string) => void} props.onConfirm - Commit the chosen ISO date.
 * @param {string} [props.ariaLabel] - Defaults to the translated "Select date".
 */
export default function DatePickerDialog({ open, value, anchorRef, min, max, onClose, onConfirm, ariaLabel }) {
  const { t, i18n } = useTranslation();
  const dialogLabel = ariaLabel || t('ui.selectDate');
  /* Intl ships month and weekday names for hi and mr, so the calendar reads in the
     visitor's language with no hand-maintained table to drift out of sync. */
  const MONTHS = useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { month: 'long' });
    return Array.from({ length: MONTH_COUNT }, (_, i) => f.format(new Date(2024, i, 1)));
  }, [i18n.language]);
  const WEEKDAYS = useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
    // 2024-01-07 was a Sunday, so this walks Sun→Sat in the grid's own order.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 7 + i)));
  }, [i18n.language]);
  const panelRef = useRef(null);
  const initial = parseIso(value) || parseIso(todayIso());
  const [view, setView] = useState({ y: initial.y, m: initial.m });
  const [draft, setDraft] = useState(parseIso(value) ? value : '');
  const [shown, setShown] = useState(false);

  // Re-seed each time the dropdown opens so it reflects the latest committed value.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const seed = parseIso(value) || parseIso(todayIso());
    setView({ y: seed.y, m: seed.m });
    setDraft(parseIso(value) ? value : '');
  }, [open, value]);

  const isBlocked = useCallback((iso) => (min && iso < min) || (max && iso > max), [min, max]);

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    let lo = cur - 30;
    let hi = cur + 5;
    if (min) lo = Math.min(lo, +min.slice(0, 4));
    if (max) hi = Math.max(hi, +max.slice(0, 4));
    lo = Math.min(lo, view.y);
    hi = Math.max(hi, view.y);
    const out = [];
    for (let y = hi; y >= lo; y -= 1) out.push({ value: String(y), label: String(y) });
    return out;
  }, [min, max, view.y]);

  const monthOptions = useMemo(() => MONTHS.map((name, i) => ({ value: String(i), label: name })), [MONTHS]);

  // Weekly grid with leading/trailing days from adjacent months. Only render the
  // weeks that actually contain a day of the current month, so a trailing row made
  // up entirely of next-month days is never shown.
  const cells = useMemo(() => {
    const lead = firstWeekday(view.y, view.m);
    const weeks = Math.ceil((lead + daysInMonth(view.y, view.m)) / 7);
    const list = [];
    for (let i = 0; i < weeks * 7; i += 1) {
      const dayNum = i - lead + 1;
      let { y, m } = view;
      let d = dayNum;
      if (dayNum < 1) {
        const prev = addMonths(view.y, view.m, -1);
        y = prev.y; m = prev.m;
        d = daysInMonth(prev.y, prev.m) + dayNum;
      } else if (dayNum > daysInMonth(view.y, view.m)) {
        const next = addMonths(view.y, view.m, 1);
        y = next.y; m = next.m;
        d = dayNum - daysInMonth(view.y, view.m);
      }
      list.push({ iso: toIso(y, m, d), d, inMonth: y === view.y && m === view.m, sunday: i % 7 === 0 });
    }
    return list;
  }, [view]);

  const shiftDraft = useCallback((deltaDays) => {
    const base = parseIso(draft) || { ...view, d: 1 };
    const dt = new Date(base.y, base.m, base.d + deltaDays);
    const iso = toIso(dt.getFullYear(), dt.getMonth(), dt.getDate());
    if (isBlocked(iso)) return;
    setDraft(iso);
    setView({ y: dt.getFullYear(), m: dt.getMonth() });
  }, [draft, view, isBlocked]);

  // Anchor the panel under the field with fixed positioning; flip up near the
  // viewport bottom and clamp horizontally so it never overflows the screen.
  const place = useCallback(() => {
    const anchor = anchorRef?.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    // Below 640px the stylesheet docks this panel as a bottom sheet. Anchoring it
    // to the field there would fight those rules (inline styles win), so stand
    // down and clear anything a previous wider layout left behind.
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
    // Clamp fully on-screen so the bottom rows + Confirm stay reachable even when
    // the field sits near the viewport edge.
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
  }, [open, place, view]);

  // Close on outside interaction — but ignore clicks inside the panel, the field
  // that opened it, and any portaled <Select> menu (the month/year dropdowns).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      if (t.closest?.('.pn-dropdown__menu, .pn-dropdown')) return;
      onClose?.();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, anchorRef, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // Let an open month/year <Select> handle Escape first.
      if (e.key === 'Escape') {
        if (document.querySelector('.pn-dropdown.is-open')) return;
        e.preventDefault(); onClose?.(); return;
      }
      if (e.key === 'Enter') { if (draft) { e.preventDefault(); onConfirm?.(draft); } return; }
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (e.key in moves) { e.preventDefault(); shiftDraft(moves[e.key]); }
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, draft, shiftDraft, onClose, onConfirm]);

  if (!open) return null;

  const today = todayIso();
  const badgeDay = parseIso(draft)?.d ?? initial.d;
  const goMonth = (delta) => setView((v) => addMonths(v.y, v.m, delta));

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={dialogLabel}
      className={`pn-cal${shown ? ' is-open' : ''}`}
    >
      <div className="pn-cal__head">
        <h3 className="pn-cal__title">{t('ui.selectDateTitle')}</h3>
        <span className="pn-cal__badge" aria-hidden="true">
          <span className="pn-cal__badge-tab" /><span className="pn-cal__badge-tab" />
          <span className="pn-cal__badge-num">{pad(badgeDay)}</span>
        </span>
      </div>

      <div className="pn-cal__selectors">
        <button type="button" className="pn-cal__nav" aria-label={t('ui.prevMonth')} onClick={() => goMonth(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <Select
          className="pn-cal__dd"
          value={String(view.m)}
          options={monthOptions}
          searchable={false}
          ariaLabel={t('ui.month')}
          onChange={(v) => setView((s) => ({ ...s, m: +v }))}
        />
        <Select
          className="pn-cal__dd pn-cal__dd--year"
          value={String(view.y)}
          options={yearOptions}
          searchable={false}
          ariaLabel={t('ui.year')}
          onChange={(v) => setView((s) => ({ ...s, y: +v }))}
        />
        <button type="button" className="pn-cal__nav" aria-label={t('ui.nextMonth')} onClick={() => goMonth(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      <div className="pn-cal__grid pn-cal__grid--head" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`pn-cal__wd${i === 0 ? ' is-sun' : ''}`}>{w}</span>
        ))}
      </div>

      <div className="pn-cal__grid" role="grid">
        {cells.map((c, i) => {
          const blocked = isBlocked(c.iso);
          const selected = c.iso === draft;
          const cls = ['pn-cal__day'];
          if (!c.inMonth) cls.push('is-muted');
          if (c.sunday) cls.push('is-sun');
          if (c.iso === today) cls.push('is-today');
          if (selected) cls.push('is-selected');
          return (
            <button
              type="button"
              key={`${c.iso}-${i}`}
              className={cls.join(' ')}
              disabled={blocked}
              aria-pressed={selected}
              aria-label={c.iso}
              onClick={() => onConfirm?.(c.iso)}
            >
              {pad(c.d)}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
