import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MultiSelect from '../../../../components/ui/MultiSelect.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';
import { fetchAreaSuggestions, fetchPlaceDetails, newAutocompleteSession } from '../../../../lib/places.js';
import { matchLocalityToCanonical, nearestLocality, slugifyLocality } from '../../../../data/localities.js';

export default function LocalitySection({ f, set, localities, onAddLocality }) {
  const { t } = useTranslation();

  // Live Google Places search for the Localities filter. To honour the
  // locality-only model while still letting people type a street or sub-area
  // (e.g. "Datta Mandir Road"), suggestions are broadened beyond locality types
  // and every pick is snapped UP to its PARENT canonical locality (e.g. Wakad)
  // via place coordinates before it enters the filter. Fails soft to the static
  // registry list when the Maps SDK / quota is unavailable.
  const locTokenRef = useRef(null);
  const mountedRef = useRef(true);
  const locSetRef = useRef(f.localities);
  useEffect(() => { locSetRef.current = f.localities; }, [f.localities]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const localityAsyncSearch = useCallback(async (query) => {
    if (!locTokenRef.current) locTokenRef.current = newAutocompleteSession();
    const preds = await fetchAreaSuggestions(query, locTokenRef.current);
    // Carry a non-slug marker value so a still-resolving pick never lands in the
    // filter set; the real snapped slug is added in onLocalityPick once coords resolve.
    return preds.map((p) => ({
      value: '__place__:' + p.placeId,
      label: p.mainText,
      sublabel: p.secondaryText,
      meta: { _p: p._p, name: p.mainText },
    }));
  }, []);

  // Drop the transient live-search marker so only real registry slugs reach the filter.
  const onLocalityChange = useCallback(
    (arr) => set({ localities: new Set(arr.filter((v) => !String(v).startsWith('__place__:'))) }),
    [set],
  );

  const onLocalityPick = useCallback(async (opt) => {
    // A static registry pick has no meta and was already added via onLocalityChange.
    if (!opt || !opt.meta) return;
    let details = null;
    try { details = await fetchPlaceDetails(opt.meta); } catch { details = null; }
    locTokenRef.current = null; // Places billing: close the session after a pick.
    if (!mountedRef.current) return;
    const name = opt.meta.name || opt.label || '';
    const lat = details ? details.lat : null;
    const lng = details ? details.lng : null;
    // Snap to the parent canonical locality: named area first (localityRaw, e.g.
    // "Wakad"), then the typed label, then the nearest registry locality by coords,
    // and only as a last resort an honest full slug of the picked name.
    const canon =
      matchLocalityToCanonical(details && details.localityRaw ? details.localityRaw : name, lat, lng) ||
      matchLocalityToCanonical(name, lat, lng) ||
      nearestLocality(lat, lng, 6) ||
      (name ? { slug: slugifyLocality(name), name } : null);
    if (!canon || !canon.slug) return;
    onAddLocality?.({ slug: canon.slug, name: canon.name });
    set({ localities: new Set([...locSetRef.current, canon.slug]) });
  }, [set, onAddLocality]);

  return (
    <>
      <FilterGroup icon="map-pin" title={t('listings.localities')} summary={f.localities.size ? t('listings.selectedCount', { count: f.localities.size }) : ''}>
        <MultiSelect
          values={[...f.localities]}
          onChange={onLocalityChange}
          options={localities.map((l) => ({ value: l.slug, label: l.name }))}
          asyncSearch={localityAsyncSearch}
          onPick={onLocalityPick}
          searchable
          placeholder={t('listings.searchLocalityPlaceholder')}
          ariaLabel={t('listings.localities')}
          className="w-full"
          autoClose
        />
      </FilterGroup>
      <Divider />
    </>
  );
}
