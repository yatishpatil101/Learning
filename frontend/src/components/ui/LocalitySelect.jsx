import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Select from './Select.jsx';
import MultiSelect from './MultiSelect.jsx';
import { getActiveCity } from '../../lib/geoConfig.js';
import {
  newAutocompleteSession,
  fetchLocalitySuggestions,
  fetchPlaceDetails,
} from '../../lib/places.js';
import { resolveLocality, searchLocalities } from '../../services/localityService.js';

const dbOption = (l) => ({ value: l.name, label: l.name, meta: { locality: l } });

/** A locality is only chosen from a Google suggestion (or a saved one when Google is down) and resolved server-side, so the stored name is canonical.
 * `nameOnly` / `unrestricted` skip the resolve and report `{ name, lat, lng }`; typed text is never committed. */
export default function LocalitySelect({
  multi = false,
  unrestricted = false,
  nameOnly = false,
  value,
  values,
  onChange,
  onSelect,
  onBusyChange,
  disabled,
  invalid,
  ...rest
}) {
  const { t } = useTranslation();
  const resolves = !unrestricted && !nameOnly;
  const tokenRef = useRef(null);
  const reqRef = useRef(0);
  const mountedRef = useRef(true);
  const live = useRef({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const errorId = useId();

  useEffect(() => {
    live.current = { onChange, onSelect, values, onBusyChange };
  });
  useEffect(() => {
    const report = live.current.onBusyChange;
    if (report) report(busy);
    return () => { if (busy && report) report(false); };
  }, [busy]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const asyncSearch = useCallback(async (q) => {
    if (!tokenRef.current) tokenRef.current = newAutocompleteSession();
    const preds = await fetchLocalitySuggestions(q, tokenRef.current, { crossCity: unrestricted });
    if (preds.length) {
      return preds.map((p) => ({
        value: p.mainText,
        label: p.mainText,
        sublabel: p.secondaryText,
        deferChange: resolves,
        meta: { _p: p._p, placeId: p.placeId },
      }));
    }
    try {
      return (await searchLocalities(q)).map(dbOption);
    } catch {
      return [];
    }
  }, [unrestricted, resolves]);

  const commit = useCallback((name, extra) => {
    const { onChange: change, onSelect: select, values: current } = live.current;
    if (multi) {
      const list = Array.isArray(current) ? current : [];
      if (!list.includes(name)) change([...list, name]);
    } else {
      change(name);
    }
    if (select) select({ name, ...extra });
  }, [multi]);

  const onPick = useCallback(async (option) => {
    const meta = option?.meta;
    if (!meta) return;
    if (meta.locality) {
      reqRef.current += 1;
      setError(null);
      setBusy(false);
      const { slug, name, lat, lng } = meta.locality;
      if (live.current.onSelect) live.current.onSelect({ slug, name, lat, lng });
      return;
    }
    const token = ++reqRef.current;
    setError(null);
    if (resolves) setBusy(true);
    let details = null;
    try {
      details = await fetchPlaceDetails(meta);
    } catch {
      details = null;
    }
    tokenRef.current = null;
    if (token !== reqRef.current || !mountedRef.current) return;
    if (!resolves) {
      if (live.current.onSelect) {
        live.current.onSelect({
          name: option.value,
          lat: details ? details.lat : null,
          lng: details ? details.lng : null,
          details: details || undefined,
        });
      }
      return;
    }
    try {
      if (!details || details.lat == null || details.lng == null) throw new Error('no place');
      const loc = await resolveLocality({
        placeId: details.placeId || meta.placeId,
        name: details.name || option.value,
        lat: details.lat,
        lng: details.lng,
        types: details.types,
      });
      if (token !== reqRef.current || !mountedRef.current) return;
      commit(loc.name, { slug: loc.slug, lat: loc.lat ?? details.lat, lng: loc.lng ?? details.lng, details });
    } catch (e) {
      if (token === reqRef.current && mountedRef.current) setError(e?.status === 422 ? (e.message && !/^HTTP \d+$/.test(e.message) ? e.message : t('ui.localityPick')) : t('ui.localityFailed'));
    } finally {
      if (token === reqRef.current && mountedRef.current) setBusy(false);
    }
  }, [resolves, commit, t]);

  const shared = {
    anchored: true,
    asyncSearch,
    onPick,
    disabled: disabled || busy,
    invalid: invalid || !!error,
    ariaDescribedBy: error ? errorId : undefined,
    noResultsText: unrestricted ? t('ui.noMatches') : `${t('ui.noMatches')} in ${getActiveCity()}`,
    ...rest,
  };

  return (
    <>
      {multi
        ? <MultiSelect values={values} onChange={onChange} {...shared} />
        : <Select value={value} onChange={onChange} {...shared} />}
      <p className="mt-1 text-xs text-gray-400 empty:hidden" role="status">{busy ? t('ui.localityAdding') : ''}</p>
      {error ? <p id={errorId} className="mt-1 text-xs text-red-400" role="alert" data-testid="locality-error">{error}</p> : null}
    </>
  );
}