import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import PoweredByGoogle from '../ui/PoweredByGoogle.jsx';
import { fetchPlaceDetails, fetchSuggestions, newAutocompleteSession } from '../../lib/places.js';

const DEBOUNCE_MS = 220;

async function resolvePoint(s) {
  const d = await fetchPlaceDetails(s);
  if (d?.lat == null || d?.lng == null) return null;
  return { near: `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`, label: d.name || s.mainText };
}

/* Inline suggestions under the field. Searches Google Places by default; `search` / `resolve` swap the source,
   and an Error thrown by `resolve` has its message shown to the user. */
export default function PlaceSearchInput({ label = '', onPick, onClear, bias = null, search, resolve = resolvePoint, clearOnPick = false, placeholder, ariaLabel }) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState(label);
  const [shownLabel, setShownLabel] = useState(label);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null);
  const reqRef = useRef(0);
  const pickRef = useRef(0);
  const pickedTextRef = useRef(label);
  const boxRef = useRef(null);

  // A value set elsewhere (URL, home search, Clear) replaces whatever was typed.
  if (shownLabel !== label) {
    setShownLabel(label);
    setQuery(label);
    setOpen(false);
  }

  useEffect(() => () => { reqRef.current += 1; pickRef.current += 1; }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === label || q === pickedTextRef.current) return undefined;
    const id = ++reqRef.current;
    const timer = setTimeout(async () => {
      if (!sessionRef.current) sessionRef.current = newAutocompleteSession();
      const list = search
        ? await search(q, sessionRef.current).catch(() => [])
        : await fetchSuggestions(q, sessionRef.current, bias ? { locationBias: bias } : {});
      if (id !== reqRef.current) return;
      setSuggestions(list);
      setActive(-1);
      setOpen(list.length > 0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, label, bias, search]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = async (s) => {
    const id = ++pickRef.current;
    reqRef.current += 1;
    pickedTextRef.current = s.mainText;
    setQuery(s.mainText);
    setOpen(false);
    setError('');
    setBusy(true);
    let value = null;
    let failure = '';
    try { value = await resolve(s); } catch (e) { failure = e?.message || ''; }
    if (id !== pickRef.current) return;
    setBusy(false);
    sessionRef.current = null;
    if (failure) { setError(failure); return; }
    if (!value) return;
    if (clearOnPick) { pickedTextRef.current = ''; setQuery(''); setSuggestions([]); }
    onPick(value);
  };

  const clear = () => {
    reqRef.current += 1;
    pickRef.current += 1;
    pickedTextRef.current = '';
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setBusy(false);
    setError('');
    if (label) onClear?.();
  };

  const onType = (e) => {
    const v = e.target.value;
    setQuery(v);
    setError('');
    if (v.trim().length < 2) setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[Math.max(active, 0)]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={boxRef}>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-gray-500" />
        <input
          type="search"
          value={query}
          onChange={onType}
          onKeyDown={onKeyDown}
          onFocus={() => { if (suggestions.length && query !== label) setOpen(true); }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          className="dz-input !pl-9 !pr-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {busy ? (
          <Icon name="loader-2" className="absolute inset-y-0 right-3 my-auto h-4 w-4 animate-spin text-teal-400" />
        ) : query ? (
          <button type="button" onClick={clear} aria-label={t('ui.clearPlace')} className="absolute inset-y-0 right-1 my-auto flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:text-gray-200">
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-red-300">{error}</p>}
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <div role="listbox" id={listId}>
            {suggestions.map((s, i) => (
              <button
                type="button"
                tabIndex={-1}
                key={s.placeId || s.slug}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                className={`flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-white/10' : ''}`}
              >
                <Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
                <span className="min-w-0">
                  <span className="block truncate text-gray-100">{s.mainText}</span>
                  {s.secondaryText && <span className="block truncate text-xs text-gray-500">{s.secondaryText}</span>}
                </span>
              </button>
            ))}
          </div>
          {suggestions.some((s) => s._p) && <div className="flex justify-end px-3 py-1.5"><PoweredByGoogle /></div>}
        </div>
      )}
    </div>
  );
}
