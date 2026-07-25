import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '../../lib/format.js';
import PoweredByGoogle from './PoweredByGoogle.jsx';

/**
 * Custom multi-select dropdown (themed, dark). Mirrors Select.jsx for visual and
 * keyboard parity, but holds an array of values and keeps the menu open while the
 * user toggles choices — the right fit for "pick all that apply" fields.
 * @param {object} props
 * @param {string[]} props.values - Currently selected values.
 * @param {(values: string[]) => void} props.onChange - Callback with the next selection.
 * @param {Array<{value: string, label: string}>|string[]} props.options - Menu options.
 * @param {string} [props.placeholder='Select…'] - Placeholder when nothing is selected.
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
  placeholder = 'Select…',
  searchable,
  className,
  disabled,
  ariaLabel,
  invalid,
  dataErr,
  autoClose,
  asyncSearch,
  onPick,
  noResultsText = 'No matches',
}, ref) {
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
  }, []);

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

  // Focus the search box once after the menu is anchored — mirrors Select and
  // avoids the inline ref callback re-focusing (and stealing focus) on every
  // re-render, which the async live-search now triggers more often.
  useLayoutEffect(() => {
    if (!open || !isSearchable) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, isSearchable]);

  const toggle = useCallback((opt) => {
    if (opt.disabled) return;
    const has = selectedSet.has(opt.value);
    onChange(has
      ? values.filter((v) => v !== opt.value)
      : [...values, opt.value]);
    if (!has && onPick) onPick(opt);
    if (autoClose) close();
  }, [onChange, selectedSet, values, autoClose, close, onPick]);

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
    <div ref={rootRef} className={classNames('pn-dropdown', open && 'is-open', className)} data-err={dataErr}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={classNames('pn-dropdown__trigger', invalid && 'pn-invalid pn-shake')}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
      >
        <span className={classNames('pn-dropdown__value', !summary && 'is-placeholder')}>
          {summary || placeholder}
        </span>
        <svg className="pn-dropdown__chev" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className={classNames('pn-dropdown__menu', 'pn-dropdown__menu--portal', portalOpen && 'is-portal-open')}
              role="listbox"
              aria-multiselectable="true"
              id={listId}
              aria-label={ariaLabel}
            >
              {isSearchable ? (
                <div className="pn-dropdown__search">
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActiveIndex(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Search…"
                    ref={searchRef}
                  />
                </div>
              ) : null}

              {visible.length === 0 ? (
                <div className="pn-dropdown__empty">
                  {loading ? 'Searching…' : noResultsText}
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
                    className={classNames('pn-dropdown__option', i === activeIndex && 'is-active')}
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
                <div className="pn-dropdown__attrib">
                  <PoweredByGoogle />
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

export default MultiSelect;
