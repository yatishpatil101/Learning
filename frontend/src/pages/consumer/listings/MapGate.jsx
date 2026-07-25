import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

/* Map view is "area-first": rendering a whole city of markers is expensive, so the
   map only appears once the user has focused on 1–maxAreas localities. This panel is
   shown in place of the map for the two gated states:
     • no areas selected  → a "focus your map" popular-area picker.
     • too many areas (> maxAreas) → a trim-down prompt with a grid-view fallback.
   Picking a single area is enough to unlock the map. */

// Areas worth suggesting first: most stock, then strongest demand.
const popularAreas = (localities, limit = 8) =>
  localities
    .filter((l) => l.active !== false)
    .slice()
    .sort((a, b) => (b.listings || 0) - (a.listings || 0) || (b.demand || 0) - (a.demand || 0))
    .slice(0, limit);

export default function MapGate({ localities, f, set, locNameBySlug, maxAreas, setView }) {
  const { t } = useTranslation();
  const selected = [...f.localities];
  const overLimit = selected.length > maxAreas;

  const toggleArea = (slug) => {
    const next = new Set(f.localities);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    set({ localities: next });
  };

  return (
    <div className="glass rounded-2xl border border-white/10 flex items-center justify-center px-6 py-14" style={{ minHeight: 520 }}>
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/12 border border-teal-400/25">
          <Icon name={overLimit ? 'layers' : 'map-pin'} className="h-7 w-7 text-teal-300" />
        </div>

        {overLimit ? (
          <>
            <h3 className="text-xl font-bold text-white">{t('listings.overLimitTitle')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
              {t('listings.overLimitPre')} <span className="text-teal-300 font-semibold">{maxAreas}</span> {t('listings.overLimitMid')}{' '}
              <span className="text-white font-semibold">{selected.length}</span>{t('listings.overLimitSuf')}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {selected.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleArea(slug)}
                  aria-label={t('listings.removeArea', { name: locNameBySlug[slug] || slug })}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-teal-500/12 border border-teal-400/30 text-teal-200 text-xs font-medium hover:bg-rose-500/15 hover:border-rose-400/40 hover:text-rose-200 t-all"
                >
                  {locNameBySlug[slug] || slug}
                  <Icon name="x" className="w-3 h-3" />
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setView('grid')}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500/10 border border-teal-400/30 text-teal-300 text-sm font-semibold hover:bg-teal-500/20 t-all"
            >
              <Icon name="layout-grid" className="w-4 h-4" /> {t('listings.viewAllAreasGrid', { count: selected.length })}
            </button>
          </>
        ) : (
          <>
            <h3 className="text-xl font-bold text-white">{t('listings.focusTitle')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
              {t('listings.focusIntro')} <span className="text-teal-300 font-semibold">{maxAreas}</span>.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {popularAreas(localities).map((l) => {
                const on = f.localities.has(l.slug);
                return (
                  <button
                    key={l.slug}
                    type="button"
                    onClick={() => toggleArea(l.slug)}
                    aria-pressed={on}
                    className={
                      'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium t-all ' +
                      (on
                        ? 'bg-teal-500/15 border-teal-400/40 text-teal-200'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:border-teal-400/40 hover:text-white')
                    }
                  >
                    <Icon name="map-pin" className="w-3.5 h-3.5" /> {l.name}
                  </button>
                );
              })}
            </div>

            <p className="mt-6 text-xs text-gray-600">
              {t('listings.preferSwitch')}{' '}
              <button type="button" onClick={() => setView('grid')} className="text-teal-400 hover:text-teal-300 font-medium underline underline-offset-2">{t('listings.gridWord')}</button>{' '}
              {t('listings.orWord')}{' '}
              <button type="button" onClick={() => setView('list')} className="text-teal-400 hover:text-teal-300 font-medium underline underline-offset-2">{t('listings.listWord')}</button> {t('listings.viewWord')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
