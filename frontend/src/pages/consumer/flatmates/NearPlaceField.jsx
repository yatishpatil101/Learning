import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Select from '../../../components/ui/Select.jsx';
import { fetchSuggestions, fetchPlaceDetails, newAutocompleteSession } from '../../../lib/places.js';

/* "Near a Place" for Flatmates — the same proximity model Listings uses, now
   possible because every post carries per-post coordinates (see helpers.withCoords).
   Pick a real place/landmark, choose a radius (distance or commute-minute), and the
   list + map narrow to posts within that radius of the point. Predictions carry no
   coordinates, so the option holds a placeholder value and the real "lat,lng" +
   display name are resolved on pick (mirrors the Localities picker). Fails soft to a
   plain field when the Maps SDK / quota is unavailable. */
export default function NearPlaceField({ filters, setF }) {
  const { t } = useTranslation();
  const nearMode = filters.nearMode || 'km';
  const nearRadius = filters.nearRadius || 5;
  const nearOpts = useMemo(
    () => (filters.near ? [{ value: filters.near, label: filters.nearLabel || t('flatmates.selectedPlace') }] : []),
    [filters.near, filters.nearLabel, t],
  );

  const tokenRef = useRef(null);
  const pickIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const asyncSearch = useCallback(async (query) => {
    if (!tokenRef.current) tokenRef.current = newAutocompleteSession();
    const preds = await fetchSuggestions(query, tokenRef.current, {});
    return preds.map((p) => ({
      value: '__place__:' + p.placeId,
      label: p.mainText,
      sublabel: p.secondaryText,
      meta: { _p: p._p, name: p.mainText },
    }));
  }, []);

  const onChange = useCallback((v) => {
    // A still-resolving live pick carries the placeholder marker; onPick sets the
    // real coordinates once details resolve. The only other value is a clear.
    if (typeof v === 'string' && v.startsWith('__place__:')) return;
    if (!v) setF({ near: '', nearLabel: '' });
  }, [setF]);

  const onPick = useCallback(async (opt) => {
    if (!opt?.meta) return; // the already-selected place — onChange handled it
    const pickId = ++pickIdRef.current; // supersede any in-flight pick
    const placeId = String(opt.value).replace('__place__:', '');
    const details = await fetchPlaceDetails({ placeId, _p: opt.meta._p });
    if (pickId !== pickIdRef.current || !mountedRef.current) return;
    if (!details || details.lat == null || details.lng == null) return;
    tokenRef.current = null; // Places billing: close the session after a pick.
    setF({ near: `${details.lat.toFixed(4)},${details.lng.toFixed(4)}`, nearLabel: details.name || opt.meta.name || opt.label || '' });
  }, [setF]);

  return (
    <div className="space-y-3">
      <Select
        value={filters.near || ''}
        onChange={onChange}
        onPick={onPick}
        asyncSearch={asyncSearch}
        options={nearOpts}
        searchable
        placeholder={t('flatmates.searchPlacePlaceholder')}
        ariaLabel={t('flatmates.ariaSearchPlace')}
        className="w-full"
      />
      {filters.near ? (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
            {[['km', 'navigation', t('flatmates.distance')], ['min', 'clock', t('flatmates.commuteTime')]].map(([mode, ic, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setF({ nearMode: mode })}
                aria-pressed={nearMode === mode}
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg t-all ${nearMode === mode ? 'bg-teal-500/20 text-teal-200 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
              >
                <Icon name={ic} className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="flex items-baseline justify-center gap-1.5">
            <input
              type="number"
              min={1}
              max={25}
              value={nearRadius}
              aria-label={t('flatmates.ariaRadiusValue')}
              onChange={(e) => setF({ nearRadius: e.target.value === '' ? '' : Number(e.target.value) })}
              onBlur={(e) => setF({ nearRadius: Math.min(25, Math.max(1, Math.round(+e.target.value) || 1)) })}
              className="w-16 text-2xl font-bold text-teal-300 tabular-nums text-center bg-white/5 border border-white/10 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <span className="text-sm text-gray-400 font-medium">{nearMode === 'km' ? t('flatmates.kmAway') : t('flatmates.minCommute')}</span>
          </div>

          <div>
            <input
              type="range"
              min="1"
              max="25"
              step="1"
              value={nearRadius}
              onChange={(e) => setF({ nearRadius: Number(e.target.value) })}
              aria-label={t('flatmates.ariaSearchRadius')}
              className="w-full accent-teal-400 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
              <span>1 {nearMode === 'km' ? t('flatmates.unitKm') : t('flatmates.unitMin')}</span>
              <span>25 {nearMode === 'km' ? t('flatmates.unitKm') : t('flatmates.unitMin')}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(nearMode === 'km' ? [1, 3, 5, 10, 25] : [5, 10, 15, 20, 25]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setF({ nearRadius: v })}
                aria-pressed={nearRadius === v}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold t-all ${nearRadius === v ? 'bg-teal-500 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
              >
                {v} {nearMode === 'km' ? t('flatmates.unitKm') : t('flatmates.unitMin')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setF({ near: '', nearLabel: '', nearRadius: 5, nearMode: 'km' })}
            className="text-[11px] font-medium text-gray-500 hover:text-gray-300 inline-flex items-center gap-1 t-all"
          >
            <Icon name="x" className="w-3 h-3" /> {t('flatmates.clearPlace')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
