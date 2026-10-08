import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import PlaceSearchInput from '../../../../components/search/PlaceSearchInput.jsx';
import { useCommitOnRelease } from '../../../../lib/useCommitOnRelease.js';
import { clampNearRadius, nearMaxFor } from '../../../../lib/nearParams.js';

export default function NearAPlaceSection({ f, set, localities }) {
  const { t } = useTranslation();
  const nearMode = f.nearMode || 'km';
  // The slider reports every step of a drag; hold the in-flight radius here and lift it when the
  // value settles, so every read-out below tracks the thumb rather than freezing mid-drag.
  const [liveRadius, setLiveRadius, radiusCommit] = useCommitOnRelease(f.nearRadius, (v) => set({ nearRadius: v }));
  const nearMax = nearMaxFor(nearMode);
  /* `null` means "not being typed in", so the field shows the committed radius. */
  const [radiusDraft, setRadiusDraft] = useState(null);
  const onRadiusType = useCallback((e) => {
    const raw = e.target.value;
    setRadiusDraft(raw);
    const n = Number(raw);
    if (raw !== '' && Number.isInteger(n) && n >= 1 && n <= nearMax) set({ nearRadius: n });
  }, [nearMax, set]);
  const onRadiusSettle = useCallback((e) => {
    const raw = e.target.value;
    setRadiusDraft(null);
    // A field left blank keeps the radius already in effect rather than snapping to the minimum:
    // deleting the text is how you start retyping, not a request to search one kilometre.
    if (raw !== '') set({ nearRadius: clampNearRadius(raw, nearMax) });
  }, [nearMax, set]);
  // Biases the live Near-a-Place search toward the area being looked in. The city hard-fence in
  // fetchSuggestions still applies, so a bias can only rank results, never leak them out.
  const nearBias = useMemo(() => {
    const pts = localities.filter((l) => f.localities.has(l.slug) && l.lat != null && l.lng != null);
    if (!pts.length) return null;
    const lat = pts.reduce((a, l) => a + l.lat, 0) / pts.length;
    const lng = pts.reduce((a, l) => a + l.lng, 0) / pts.length;
    const d = 0.06;
    return { north: lat + d, south: lat - d, east: lng + d, west: lng - d };
  }, [f.localities, localities]);
  const nearName = f.nearLabel || '';
  const onPlacePick = ({ near, label }) => set({ near, nearLabel: label });
  const onPlaceClear = () => set({ near: '', nearLabel: '' });

  // Reveal the radius controls once, when a place first appears — not on every re-pick. Scroll the
  // panel's OWN container: scrolling the window jumps the whole page.
  const nearPanelRef = useRef(null);
  const hadNearRef = useRef(!!f.near);
  useEffect(() => {
    const had = hadNearRef.current;
    hadNearRef.current = !!f.near;
    if (!f.near || had) return;
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
          <PlaceSearchInput
            label={f.near ? (nearName || t('listings.selectedPlace')) : ''}
            onPick={onPlacePick}
            onClear={onPlaceClear}
            bias={nearBias}
            placeholder={t('listings.searchPlacePlaceholder')}
            ariaLabel={t('listings.searchPlaceAria')}
          />
          {f.near ? (
            <div ref={nearPanelRef} className="space-y-4 pt-1">

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

              <div className="flex items-baseline justify-center gap-1.5">
                {/* Lifted on release, not per step — a whole drag is one search otherwise. */}
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

              <div>

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
