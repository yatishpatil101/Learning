import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import Select from '../../../../components/ui/Select.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import { fetchPlaceDetails, fetchSuggestions, newAutocompleteSession } from '../../../../lib/places.js';
import { localityBySlug, matchLocalityToCanonical, nearestLocality } from '../../../../data/localities.js';

export default function NearAPlaceSection({ f, set, onAddLocality }) {
  const { t } = useTranslation();
  const nearMode = f.nearMode || 'km';
  // When a picked place sits in a locality the user hasn't selected (e.g. a mall in
  // Hinjawadi while only "Baner" is chosen), the two location filters silently
  // contradict and return nothing. We nudge the user to add that parent locality
  // instead of leaving them on a blank 0-results screen. The nudge is DERIVED from
  // state (near is stored as "lat,lng", so the parent locality snaps synchronously)
  // rather than computed only at pick-time — so it fires whether the point was picked
  // here OR arrived from the home search / a shared URL. `nearDismissed` holds the
  // f.near value the user dismissed the nudge for.
  const [nearDismissed, setNearDismissed] = useState(null);
  const nearHint = useMemo(() => {
    if (!f.near) return null;
    const [latS, lngS] = String(f.near).split(',');
    const lat = parseFloat(latS);
    const lng = parseFloat(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const canon = matchLocalityToCanonical(f.nearLabel, lat, lng) || nearestLocality(lat, lng, 6);
    if (!canon || !canon.slug) return null;
    if (f.localities.size === 0 || f.localities.has(canon.slug)) return null;
    return { slug: canon.slug, name: canon.name };
  }, [f.near, f.nearLabel, f.localities]);
  // Averaged centre of the localities the user has already chosen — biases the live
  // Near-a-Place search toward the area they are actually looking in. The city hard-fence
  // in fetchSuggestions still applies on top, so a bias can only rank results, never leak
  // them out of the active city.
  const nearBias = useMemo(() => {
    const pts = [...f.localities].map((s) => localityBySlug(s)).filter((l) => l && l.lat != null && l.lng != null);
    if (!pts.length) return null;
    const lat = pts.reduce((a, l) => a + l.lat, 0) / pts.length;
    const lng = pts.reduce((a, l) => a + l.lng, 0) / pts.length;
    const d = 0.06; // ~6 km ranking box around the selected area
    return { north: lat + d, south: lat - d, east: lng + d, west: lng - d };
  }, [f.localities]);
  // A point set from a home-search society/POI surfaces its real name (f.nearLabel) both as
  // a synthetic option (so the Select trigger reads it, not raw coords) and in the summary.
  // No static seed list — suggestions come only from the live Google search below.
  const nearName = f.nearLabel || '';
  const nearOpts = useMemo(
    () => (f.near ? [{ value: f.near, label: f.nearLabel || t('listings.selectedPlace') }] : []),
    [f.near, f.nearLabel, t],
  );

  // Live Google Places search for the Near-a-Place field so suggestions are REAL places
  // near the selected locality, not a fixed seed list. Predictions carry no coordinates,
  // so (like the Localities picker) options hold a placeholder value and the real
  // "lat,lng" + display name are resolved on pick.
  const nearTokenRef = useRef(null);
  const nearPickIdRef = useRef(0);
  const mountedRef = useRef(true);
  const locSetRef = useRef(f.localities);
  useEffect(() => { locSetRef.current = f.localities; }, [f.localities]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const nearAsyncSearch = useCallback(async (query) => {
    if (!nearTokenRef.current) nearTokenRef.current = newAutocompleteSession();
    const preds = await fetchSuggestions(query, nearTokenRef.current, nearBias ? { locationBias: nearBias } : {});
    return preds.map((p) => ({
      value: '__place__:' + p.placeId,
      label: p.mainText,
      sublabel: p.secondaryText,
      meta: { _p: p._p, name: p.mainText },
    }));
  }, [nearBias]);
  const onNearChange = useCallback((v) => {
    // A still-resolving live pick carries the placeholder marker; ignore it here and let
    // onNearPick set the real coordinates once its details resolve.
    if (typeof v === 'string' && v.startsWith('__place__:')) return;
    // The only non-placeholder option is the already-selected place (or a clear).
    const opt = nearOpts.find((o) => o.value === v);
    set({ near: v || '', nearLabel: v ? (opt?.label || f.nearLabel || '') : '' });
  }, [nearOpts, set, f.nearLabel]);
  const onNearPick = useCallback(async (opt) => {
    if (!opt?.meta) return; // the already-selected place — onNearChange handled it
    const pickId = ++nearPickIdRef.current; // supersede any in-flight pick
    const placeId = String(opt.value).replace('__place__:', '');
    const details = await fetchPlaceDetails({ placeId, _p: opt.meta._p });
    // Ignore a stale/late response once a newer pick started or the panel unmounted.
    if (pickId !== nearPickIdRef.current || !mountedRef.current) return;
    if (!details || details.lat == null || details.lng == null) return;
    nearTokenRef.current = null; // Places billing: close the session after a pick.
    set({ near: `${details.lat.toFixed(4)},${details.lng.toFixed(4)}`, nearLabel: details.name || opt.meta.name || opt.label || '' });
  }, [set]);

  // Accept the "add this place's locality" nudge: register + select the parent
  // locality. The derived nearHint then self-hides once the locality is selected.
  const onAddNearLocality = useCallback(() => {
    if (!nearHint) return;
    onAddLocality?.({ slug: nearHint.slug, name: nearHint.name });
    set({ localities: new Set([...locSetRef.current, nearHint.slug]) });
  }, [nearHint, onAddLocality, set]);

  // Once a landmark is picked, the distance/commute controls unfold below the
  // select. Reveal them by scrolling only the filter panel's OWN scroll
  // container (never the window — that would reintroduce the page-jump bug).
  const nearPanelRef = useRef(null);
  useEffect(() => {
    if (!f.near) return;
    const panel = nearPanelRef.current;
    const scroller = panel?.closest('.filter-scroll');
    if (!scroller) return;
    requestAnimationFrame(() => {
      const overflow = panel.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
      if (overflow > 0) scroller.scrollTo({ top: scroller.scrollTop + overflow + 16, behavior: 'smooth' });
    });
  }, [f.near]);

  return (
    <>
      <FilterGroup icon="map-pinned" title={t('listings.nearAPlace')} summary={f.near ? `${nearName || t('listings.placeCap')} · ${f.nearRadius} ${nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}` : ''} defaultCollapsed={!f.near}>
        <div className="space-y-3">
          <Select
            value={f.near || ''}
            onChange={onNearChange}
            onPick={onNearPick}
            asyncSearch={nearAsyncSearch}
            options={nearOpts}
            searchable
            placeholder={t('listings.searchPlacePlaceholder')}
            ariaLabel={t('listings.searchPlaceAria')}
            className="w-full"
          />
          {nearHint && nearDismissed !== f.near ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-teal-500/20 bg-teal-500/10 px-3 py-2.5">
              <Icon name="info" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-300 leading-snug">
                  <span className="font-semibold text-white">{nearName || t('listings.thisPlace')}</span> {t('listings.nearHintBody', { name: nearHint.name })}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button type="button" onClick={onAddNearLocality} className="text-xs font-semibold text-teal-300 hover:text-teal-200 t-all">
                    {t('listings.addLocalityBtn', { name: nearHint.name })}
                  </button>
                  <button type="button" onClick={() => setNearDismissed(f.near)} className="text-xs text-gray-500 hover:text-gray-300 t-all">
                    {t('listings.dismiss')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {f.near ? (
            <div ref={nearPanelRef} className="space-y-4 pt-1">
              {/* Distance vs commute-time — segmented control */}
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                {[['km', 'navigation', t('listings.distance')], ['min', 'clock', t('listings.commuteTime')]].map(([mode, ic, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set({ nearMode: mode })}
                    aria-pressed={nearMode === mode}
                    className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-lg t-all ${nearMode === mode ? 'bg-teal-500/20 text-teal-200 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    <Icon name={ic} className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>

              {/* Selected radius */}
              <div className="flex items-baseline justify-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={f.nearRadius}
                  aria-label={t('listings.searchRadiusValue')}
                  onChange={(e) => set({ nearRadius: e.target.value === '' ? '' : Number(e.target.value) })}
                  onBlur={(e) => set({ nearRadius: Math.min(25, Math.max(1, Math.round(+e.target.value) || 1)) })}
                  className="w-16 text-2xl font-bold text-teal-300 tabular-nums text-center bg-white/5 border border-white/10 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
                <span className="text-sm text-gray-400 font-medium">{nearMode === 'km' ? t('listings.kmAway') : t('listings.minCommute')}</span>
              </div>

              {/* Distance slider */}
              <div>
                <input
                  type="range"
                  min="1"
                  max="25"
                  step="1"
                  value={f.nearRadius}
                  onChange={(e) => set({ nearRadius: Number(e.target.value) })}
                  aria-label={t('listings.searchRadius')}
                  className="w-full accent-teal-400 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                  <span>1 {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}</span>
                  <span>25 {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}</span>
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5">
                {(nearMode === 'km' ? [1, 3, 5, 10, 25] : [5, 10, 15, 20, 25]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ nearRadius: v })}
                    aria-pressed={f.nearRadius === v}
                    className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold t-all ${f.nearRadius === v ? 'bg-teal-500 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                  >
                    {v} {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-gray-500 leading-snug flex items-start gap-1.5">
                <Icon name="info" className="w-3.5 h-3.5 mt-px shrink-0 text-gray-600" />
                {nearMode === 'min'
                  ? t('listings.kmRadiusHelp', { km: (f.nearRadius * 0.4).toFixed(1) })
                  : t('listings.minCommuteHelp', { min: Math.round(f.nearRadius / 0.4) })}
              </p>
            </div>
          ) : null}
        </div>
      </FilterGroup>
      <Divider />
    </>
  );
}
