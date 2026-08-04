import { useCallback, useEffect, useRef } from 'react';
import Select from './Select.jsx';
import MultiSelect from './MultiSelect.jsx';
import { getActiveCity } from '../../lib/geoConfig.js';
import {
  newAutocompleteSession,
  fetchLocalitySuggestions,
  fetchPlaceDetails,
} from '../../lib/places.js';

/**
 * Locality picker backed by Google Places (New), so users can choose ANY Pune
 * locality — not just a hardcoded shortlist. It's a thin skin over the themed
 * Select / MultiSelect: it passes the static `options` as an offline fallback and
 * layers live, Pune-biased locality suggestions on top while typing. If Google is
 * unavailable (no key, quota exhausted, offline) the search returns nothing and the
 * control silently degrades to filtering the static list — never a regression.
 *
 * The stored value stays the locality NAME string (backward compatible with every
 * existing `form.locality`). On selecting a live suggestion, `onSelect` fires with
 * `{ name, lat, lng }` (coords resolved from the place) so callers can recenter a map.
 *
 * @param {object} props
 * @param {boolean} [props.multi] - Multi-select variant (returns/accepts an array of names).
 * @param {boolean} [props.unrestricted] - Skip the active-city hard-fence for genuinely
 *   cross-city fields (e.g. an intercity move's origin/destination). The admin blacklist
 *   still applies. Defaults to false (city-scoped).
 * @param {string} [props.value] - Selected name (single).
 * @param {string[]} [props.values] - Selected names (multi).
 * @param {(value: string) => void} [props.onChange] - Name change (single).
 * @param {(values: string[]) => void} [props.onChange] - Names change (multi).
 * @param {(sel: {name: string, lat: number|null, lng: number|null, details?: object}) => void} [props.onSelect]
 *   - Fired after a pick with resolved coords (null when picked from the static list).
 * @param {Array<string|{value,label}>} [props.options] - Static fallback options.
 *   (All other props pass through to the underlying Select / MultiSelect.)
 */
export default function LocalitySelect({
  multi = false,
  unrestricted = false,
  value,
  values,
  onChange,
  onSelect,
  options = [],
  ...rest
}) {
  // One session token per typing burst groups the suggestion calls with the final
  // details fetch into a single billable Places session; reset after each resolve.
  const tokenRef = useRef(null);
  // The details fetch is async and this control often lives in a modal (Flatmates)
  // that can close mid-resolve — don't fire onSelect into an unmounted parent.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const asyncSearch = useCallback(async (q) => {
    if (!tokenRef.current) tokenRef.current = newAutocompleteSession();
    const preds = await fetchLocalitySuggestions(q, tokenRef.current, { crossCity: unrestricted });
    return preds.map((p) => ({
      value: p.mainText,
      label: p.mainText,
      sublabel: p.secondaryText,
      meta: { _p: p._p, placeId: p.placeId },
    }));
  }, [unrestricted]);

  const onPick = useCallback(async (option) => {
    // Picked from the static fallback list — no Place to resolve; report name only.
    if (!option || !option.meta) {
      if (onSelect) onSelect({ name: option ? option.value : '', lat: null, lng: null });
      return;
    }
    let details = null;
    try {
      details = await fetchPlaceDetails(option.meta);
    } catch {
      details = null;
    }
    tokenRef.current = null;
    if (!mountedRef.current) return;
    if (onSelect) {
      onSelect({
        name: option.value,
        lat: details ? details.lat : null,
        lng: details ? details.lng : null,
        details: details || undefined,
      });
    }
  }, [onSelect]);

  if (multi) {
    return (
      <MultiSelect
        values={values}
        onChange={onChange}
        options={options}
        asyncSearch={asyncSearch}
        onPick={onPick}
        noResultsText={unrestricted ? 'No matches' : `No matches in ${getActiveCity()}`}
        {...rest}
      />
    );
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      asyncSearch={asyncSearch}
      onPick={onPick}
      noResultsText={unrestricted ? 'No matches' : `No matches in ${getActiveCity()}`}
      {...rest}
    />
  );
}
