import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import Select from '../../../../components/ui/Select.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import { fetchPlaceDetails, fetchSuggestions, newAutocompleteSession } from '../../../../lib/places.js';
import { useCommitOnRelease } from '../../../../lib/useCommitOnRelease.js';
import { clampNearRadius, nearMaxFor } from '../../../../lib/nearParams.js';
import { localityBySlug, matchLocalityToCanonical, nearestLocality } from '../../../../data/localities.js';

export default function NearAPlaceSection({ f, set, onAddLocality }) {
  const { t } = useTranslation();
  const nearMode = f.nearMode || 'km';
  // The slider reports every step of a drag; hold the in-flight radius here and lift it when the
  // value settles, so every read-out below tracks the thumb rather than freezing mid-drag.
  const [liveRadius, setLiveRadius, radiusCommit] = useCommitOnRelease(f.nearRadius, (v) => set({ nearRadius: v }));
  const nearMax = nearMaxFor(nearMode);
  /* The number field's half-typed text, held here rather than in the filter. A blank or
     out-of-range string is a keystroke on the way somewhere, not a radius the user chose: writing
     it through stores `''`, which makes `nearParams` drop the centre point along with the radius —
     the whole proximity filter silently off while the chip still names the place.
     `null` means "not being typed in", so the field shows the committed radius. */
  const [radiusDraft, setRadiusDraft] = useState(null);
  const onRadiusType = useCallback((e) => {
    const raw = e.target.value;
    setRadiusDraft(raw);
    const n = Number(raw);
    // Commit as they type, but only a value they could have meant; the rest waits for blur.
    if (raw !== '' && Number.isInteger(n) && n >= 1 && n <= nearMax) set({ nearRadius: n });
  }, [nearMax, set]);
  const onRadiusSettle = useCallback((e) => {
    const raw = e.target.value;
    setRadiusDraft(null);
    // A field left blank keeps the radius already in effect rather than snapping to the minimum:
    // deleting the text is how you start retyping, not a request to search one kilometre.
    if (raw !== '') set({ nearRadius: clampNearRadius(raw, nearMax) });
  }, [nearMax, set]);
  // A place in an unselected locality makes the two location filters contradict and return
  // nothing, so nudge the user to add the parent. Derived from state, so it fires for shared URLs.
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
  // Biases the live Near-a-Place search toward the area being looked in. The city hard-fence in
  // fetchSuggestions still applies, so a bias can only rank results, never leak them out.
  const nearBias = useMemo(() => {
    const pts = [...f.localities].map((s) => localityBySlug(s)).filter((l) => l && l.lat != null && l.lng != null);
    if (!pts.length) return null;
    const lat = pts.reduce((a, l) => a + l.lat, 0) / pts.length;
    const lng = pts.reduce((a, l) => a + l.lng, 0) / pts.length;
    const d = 0.06; // ~6 km ranking box around the selected area
    return { north: lat + d, south: lat - d, east: lng + d, west: lng - d };
  }, [f.localities]);
  // A point set from a home-search POI is surfaced as a synthetic option so the Select trigger
  // reads its real name rather than raw coords. No seed list — suggestions are live.
  const nearName = f.nearLabel || '';
  const nearOpts = useMemo(
    () => (f.near ? [{ value: f.near, label: f.nearLabel || t('listings.selectedPlace') }] : []),
    [f.near, f.nearLabel, t],
  );

  // Live Google Places search, so suggestions are real places near the selected locality.
  // Predictions carry no coordinates, so options hold a placeholder resolved on pick.
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

  // Reveal the unfolded controls by scrolling the filter panel's OWN scroll container —
  // scrolling the window here jumps the whole page.
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
      <FilterGroup icon="map-pinned" title={t('listings.nearAPlace')} summary={f.near ? `${nearName || t('listings.placeCap')} · ${liveRadius} ${nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}` : ''} defaultCollapsed={!f.near}>
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
                  max={nearMax}
                  value={radiusDraft ?? liveRadius}
                  aria-label={t('listings.searchRadiusValue')}
                  onChange={onRadiusType}
                  onBlur={onRadiusSettle}
                  className="w-16 text-2xl font-bold text-teal-300 tabular-nums text-center bg-white/5 border border-white/10 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
                <span className="text-sm text-gray-400 font-medium">{nearMode === 'km' ? t('listings.kmAway') : t('listings.minCommute')}</span>
              </div>

              {/* Distance slider */}
              <div>
                {/* Lifted on release, not per step — a whole drag is one search otherwise.
                    The twin number field above stays immediate: typing is already one intent. */}
                <input
                  type="range"
                  min="1"
                  max={nearMax}
                  step="1"
                  value={liveRadius}
                  onChange={(e) => setLiveRadius(Number(e.target.value))}
                  {...radiusCommit}
                  aria-label={t('listings.searchRadius')}
                  className="w-full accent-teal-400 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
                  <span>1 {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}</span>
                  <span>{nearMax} {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}</span>
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-1.5">
                {(nearMode === 'km' ? [1, 3, 5, 10, nearMax] : [5, 10, 15, 20, nearMax]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ nearRadius: v })}
                    aria-pressed={liveRadius === v}
                    className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold t-all ${liveRadius === v ? 'bg-teal-500 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
                  >
                    {v} {nearMode === 'km' ? t('listings.unitKm') : t('listings.unitMin')}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-gray-500 leading-snug flex items-start gap-1.5">
                <Icon name="info" className="w-3.5 h-3.5 mt-px shrink-0 text-gray-600" />
                {nearMode === 'min'
                  ? t('listings.kmRadiusHelp', { km: (liveRadius * 0.4).toFixed(1) })
                  : t('listings.minCommuteHelp', { min: Math.round(liveRadius / 0.4) })}
              </p>
            </div>
          ) : null}
        </div>
      </FilterGroup>
      <Divider />
    </>
  );
}
