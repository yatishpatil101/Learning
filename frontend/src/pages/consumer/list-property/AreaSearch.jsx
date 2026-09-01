import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fld } from './styles.js';
import { newAutocompleteSession, fetchSuggestions, fetchPlaceDetails } from './geocode.js';

/* Google-Maps-style area/society search with live autocomplete predictions.
   As the owner types we fetch Places (New) suggestions (debounced) and show them
   in a dark dropdown; picking one resolves the exact location + address details and
   hands them to `onSelectPlace`. The teal button + Enter still run the plain text
   search (`onRunSearch`) as a fallback when no suggestion is highlighted. */

const DEBOUNCE_MS = 220;

export default function AreaSearch({
  value, onChange, onRunSearch, onSelectPlace, status, invalid, placeholder,
}) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const listId = useId();

  const sessionRef = useRef(null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  // Skip the fetch that would fire from the programmatic setValue after a pick.
  const skipNextRef = useRef(false);

  const ensureSession = () => {
    if (!sessionRef.current) sessionRef.current = newAutocompleteSession();
    return sessionRef.current;
  };

  // Debounced suggestion fetch driven by the (parent-controlled) input value.
  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return; }
    const q = String(value || '').trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setSuggestions([]); setOpen(false); setLoading(false);
      return undefined;
    }
    setLoading(true);
    const id = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      const list = await fetchSuggestions(q, ensureSession());
      if (id !== reqIdRef.current) return; // a newer keystroke superseded this one
      setSuggestions(list);
      setActive(-1);
      setOpen(list.length > 0);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  // Close the dropdown when clicking away.
  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = useCallback(async (sugg) => {
    if (!sugg) return;
    skipNextRef.current = true;
    onChange(sugg.mainText || sugg.secondaryText || '');
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
    setResolving(true);
    const details = await fetchPlaceDetails(sugg);
    setResolving(false);
    // A new session begins after a committed pick (per Places session-token rules).
    sessionRef.current = null;
    if (details && details.lat != null && details.lng != null) onSelectPlace(details);
  }, [onChange, onSelectPlace]);

  const onKeyDown = (e) => {
    if (open && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0) choose(suggestions[active]);
        else onRunSearch();
        return;
      }
      if (e.key === 'Escape') { setOpen(false); return; }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onRunSearch();
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => { if (suggestions.length) setOpen(true); }}
            placeholder={placeholder}
            className={`${fld} w-full ${invalid ? 'dz-invalid' : ''}`}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {(loading || resolving) && (
            <Loader2 className="w-4 h-4 text-teal-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
          )}
          {open && suggestions.length > 0 && (
            <ul className="dz-ac-list" role="listbox" id={listId}>
              {suggestions.map((s, i) => (
                <li
                  key={s.placeId}
                  role="option"
                  aria-selected={i === active}
                  className={`dz-ac-item ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                >
                  <MapPin className="dz-ac-pin" />
                  <span className="dz-ac-text">
                    <span className="dz-ac-main">{s.mainText}</span>
                    {s.secondaryText && <span className="dz-ac-sub">{s.secondaryText}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onRunSearch}
          className="btn-teal px-4 rounded-xl text-white font-semibold text-sm flex items-center gap-2 shrink-0"
          aria-label={t('listProperty.areaSearch.searchAria')}
        >
          <Search className="w-4 h-4" /> <span className="hidden sm:inline">{t('listProperty.areaSearch.search')}</span>
        </button>
      </div>
      {status === 'searching' && <p className="text-gray-500 text-xs mt-2">{t('listProperty.areaSearch.searching')}</p>}
      {status === 'notfound' && <p className="text-red-400 text-xs mt-2">{t('listProperty.areaSearch.notfound')}</p>}
    </div>
  );
}
