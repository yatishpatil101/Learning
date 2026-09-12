import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { classNames } from '../../lib/format.js';
import useSheetViewport from '../../lib/useSheetViewport.js';
import useSwipeDismiss from '../../lib/useSwipeDismiss.js';
import PoweredByGoogle from './PoweredByGoogle.jsx';

/* Selection order is meaningful here (it drives the trigger summary), so an
   order-sensitive compare is the right equality for "has the parent caught up". */
const sameValues = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Custom multi-select dropdown (themed, dark). Mirrors Select.jsx for visual and
 * keyboard parity, but holds an array of values and keeps the menu open while the
 * user toggles choices — the right fit for "pick all that apply" fields.
 * @param {object} props
 * @param {string[]} props.values - Currently selected values.
 * @param {(values: string[]) => void} props.onChange - Callback with the next selection.
 * @param {Array<{value: string, label: string}>|string[]} props.options - Menu options.
 * @param {string} [props.placeholder] - Placeholder when nothing is selected; defaults to the translated "Select…".
 * @param {boolean} [props.searchable] - Force search input (auto-enabled for ≥8 options).
 * @param {string} [props.className] - Additional class on the trigger wrapper.
 * @param {boolean} [props.disabled] - Disable interaction.
 * @param {string} [props.ariaLabel] - Accessible label for the trigger button.
 * @param {boolean} [props.invalid] - Show error styling.
 * @param {string} [props.dataErr] - data-err attribute for field-error binding.
 * @param {boolean} [props.autoClose] - Close the menu after each selection (single-pick feel).
 * @param {(query: string) => Promise<Array>} [props.asyncSearch] - Optional live search (see Select).
 * @param {(option: object) => void} [props.onPick] - Called with the full option when one is added.
 */
const MultiSelect = forwardRef(function MultiSelect({
  values = [],
  onChange,
  options = [],
  placeholder,
  searchable,
  className,
  disabled,
  ariaLabel,
  invalid,
  dataErr,
  autoClose,
  asyncSearch,
  onPick,
  noResultsText,
}, ref) {
  const { t } = useTranslation();
  /* Resolved at render rather than as a default parameter: a default is evaluated
     against whatever language was active on first mount and would never follow a
     later switch. */
  const noResults = noResultsText || t('ui.noMatches');
  const opts = useMemo(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options],
  );
  const isSearchable = searchable ?? (asyncSearch ? true : opts.length >= 8);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [asyncOpts, setAsyncOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  useImperativeHandle(ref, () => triggerRef.current, []);
  const [portalOpen, setPortalOpen] = useState(false);
  const listId = useId();
  /* On phones the menu docks to the bottom edge as a sheet instead of hanging off
     the trigger: an anchored panel there opens under the thumb's own hand and is
     routinely half-covered by the keyboard when the field is searchable. */
  const sheet = useSheetViewport();

  const selectedSet = useMemo(() => new Set(values), [values]);
  const summary = useMemo(
    () => {
      const known = opts.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
      // Values chosen from live search aren't in the static list — show them too.
      const knownVals = new Set(opts.map((o) => o.value));
      const extra = values.filter((v) => !knownVals.has(v));
      return [...known, ...extra].join(', ');
    },
    [opts, selectedSet, values],
  );
  const asyncNorm = useMemo(
    () => asyncOpts.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [asyncOpts],
  );
  const usingAsync = !!asyncSearch && query.trim().length >= 2 && asyncNorm.length > 0;
  const visible = useMemo(() => {
    if (usingAsync) return asyncNorm;
    if (!isSearchable || !query) return opts;
    const q = query.toLowerCase();
    return opts.filter((o) => o.label.toLowerCase().includes(q));
  }, [opts, asyncNorm, usingAsync, query, isSearchable]);

  const close = useCallback(() => {
    setOpen(false);
    setPortalOpen(false);
    setQuery('');
    setActiveIndex(-1);
    setAsyncOpts([]);
    setLoading(false);
  }, []);

  // Debounced live search — mirrors Select; races guarded by a cancelled flag.
  useEffect(() => {
    if (!asyncSearch || !open) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setAsyncOpts([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => asyncSearch(q))
        .then((res) => {
          if (!cancelled) setAsyncOpts(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          if (!cancelled) setAsyncOpts([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [asyncSearch, open, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const inRoot = rootRef.current && rootRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inRoot && !inMenu) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  // Portal the menu to <body> and anchor it to the trigger with fixed
  // positioning so it escapes any ancestor overflow/transform trap and can
  // flip up near the viewport edge — identical behaviour to Select.
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    // Sheet mode is laid out entirely in CSS. Drop any inline geometry a previous
    // desktop-width pass wrote, or it would out-specify the sheet rules.
    if (sheet) { menu.removeAttribute('style'); return; }
    const r = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.right = 'auto';
    menu.style.width = 'auto';
    menu.style.minWidth = `${r.width}px`;
    menu.style.maxWidth = `${window.innerWidth - 16}px`;
    menu.style.zIndex = '9999';
    const mw = menu.offsetWidth;
    let left = r.left;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - mw);
    menu.style.left = `${left}px`;
    menu.style.top = `${r.bottom + 8}px`;
    const mh = menu.offsetHeight;
    if (r.bottom + 8 + mh > window.innerHeight && r.top - 8 - mh > 0) {
      menu.style.top = `${r.top - 8 - mh}px`;
    }
  }, [sheet]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    position();
    const raf = requestAnimationFrame(() => setPortalOpen(true));
    const onAnchor = () => position();
    window.addEventListener('scroll', onAnchor, true);
    window.addEventListener('resize', onAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onAnchor, true);
      window.removeEventListener('resize', onAnchor);
    };
  }, [open, position, visible.length]);

  /* A sheet covers the page, so the page behind it must not scroll with it. */
  useEffect(() => {
    if (!open || !sheet) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, sheet]);

  // Focus the search box once after the menu is anchored — mirrors Select and
  // avoids the inline ref callback re-focusing (and stealing focus) on every
  // re-render, which the async live-search now triggers more often.
  useLayoutEffect(() => {
    if (!open || !isSearchable) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, isSearchable]);

  /* Our last emission, and the `values` prop it was derived from.

     A parent may apply `onChange` inside a React transition (the Listings filters do:
     recomputing results is expensive, so the commit is deliberately low priority). Until
     that transition commits, `values` is still the pre-click array — so deriving the next
     toggle from the prop silently discards every pick but the last. Reproduced at 8x CPU
     throttle: three consecutive picks in the Property Type filter left exactly one
     selected, 3/3 runs. On a mid-range phone that is an ordinary tap speed.

     So: while the prop still equals what we were handed when we emitted, keep building on
     what we emitted. The moment it differs, the parent has spoken (it committed ours, or
     changed the value itself) and the prop wins again. */
  const pendingRef = useRef(null);
  const toggle = useCallback((opt) => {
    if (opt.disabled) return;
    const pending = pendingRef.current;
    const current = pending && sameValues(pending.from, values) ? pending.next : values;
    const has = current.includes(opt.value);
    const next = has
      ? current.filter((v) => v !== opt.value)
      : [...current, opt.value];
    pendingRef.current = { from: values, next };
    onChange(next);
    if (!has && onPick) onPick(opt);
    if (autoClose) close();
  }, [onChange, values, autoClose, close, onPick]);

  /* Drag the sheet's grab handle down to dismiss. Mobile-only by construction. */
  const swipe = useSwipeDismiss(close);

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(visible.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (!isSearchable || e.key === 'Enter') {
          e.preventDefault();
          if (visible[activeIndex]) toggle(visible[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={classNames('dz-dropdown', open && 'is-open', className)} data-err={dataErr}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={classNames('dz-dropdown__trigger', invalid && 'dz-invalid dz-shake')}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
      >
        <span className={classNames('dz-dropdown__value', !summary && 'is-placeholder')}>
          {summary || (placeholder || t('ui.selectPlaceholder'))}
        </span>
        <svg className="dz-dropdown__chev" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <>
              {/* Scrim: a sheet is a modal surface, so the page behind it has to
                  read as dismissed rather than merely covered. */}
              {sheet ? <div className="dz-dropdown__scrim" onClick={close} aria-hidden="true" /> : null}
              <div
                ref={menuRef}
                {...(sheet ? swipe : null)}
                className={classNames('dz-dropdown__menu', 'dz-dropdown__menu--portal', sheet && 'dz-dropdown__menu--sheet', portalOpen && 'is-portal-open')}
                role="listbox"
                aria-multiselectable="true"
                id={listId}
                aria-label={ariaLabel}
              >
                {isSearchable ? (
                  <div className="dz-dropdown__search">
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveIndex(0);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder={t('ui.searchPlaceholder')}
                      ref={searchRef}
                    />
                  </div>
                ) : null}

                {visible.length === 0 ? (
                  <div className="dz-dropdown__empty">
                    {loading ? t('ui.searching') : noResults}
                  </div>
                ) : (
                  visible.map((o, i) => (
                    <button
                      type="button"
                      key={`${o.value}-${i}`}
                      role="option"
                      aria-selected={selectedSet.has(o.value)}
                      disabled={o.disabled}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => toggle(o)}
                      className={classNames('dz-dropdown__option', i === activeIndex && 'is-active')}
                    >
                      <span className="opt-label">
                        {o.label}
                        {o.sublabel ? <span className="opt-sub"> {o.sublabel}</span> : null}
                      </span>
                      <svg className="opt-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  ))
                )}

                {usingAsync ? (
                  <div className="dz-dropdown__attrib">
                    <PoweredByGoogle />
                  </div>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
});

export default MultiSelect;
