import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NearPlaceField from './NearPlaceField.jsx';

/* Flatmates map is "area-first": the aggregated bubble map is calmest and most
   useful once the seeker focuses on a handful of localities (mirrors the Listings
   MapGate). Shown in place of the map until the user picks 1–maxAreas areas OR
   searches a place (a proximity search self-focuses the map to the point's radius).
   Two gated states:
     • no areas → a "focus your map" picker of localities that actually hold posts.
     • too many areas (> maxAreas) → a trim-down prompt with a list-view fallback. */
export default function FlatmateMapGate({ areas, selected, onToggle, maxAreas, onSwitchList, kindWord, filters, setF, filtersActive, onClearFilters }) {
  const { t } = useTranslation();
  const kindText = t('flatmates.kind_' + kindWord);
  const overLimit = selected.size > maxAreas;
  const visibleAreas = areas.slice(0, 8);

  return (
    <div className="glass rounded-2xl border border-white/10 flex items-center justify-center px-6 py-12" style={{ minHeight: 520 }}>
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/12 border border-teal-400/25">
          <Icon name={overLimit ? 'layers' : 'map-pin'} className="h-7 w-7 text-teal-300" />
        </div>

        {overLimit ? (
          <>
            <h3 className="text-xl font-bold text-white">{t('flatmates.overLimitTitle')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
              {t('flatmates.overLimitPre')} <span className="text-teal-300 font-semibold">{maxAreas}</span> {t('flatmates.overLimitMid')}{' '}
              <span className="text-white font-semibold">{selected.size}</span>{t('flatmates.overLimitSuf')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {[...selected].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onToggle(name)}
                  aria-label={t('flatmates.ariaRemoveArea', { name })}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-teal-500/12 border border-teal-400/30 text-teal-200 text-xs font-medium hover:bg-rose-500/15 hover:border-rose-400/40 hover:text-rose-200 t-all"
                >
                  {name}
                  <Icon name="x" className="w-3 h-3" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onSwitchList}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500/10 border border-teal-400/30 text-teal-300 text-sm font-semibold hover:bg-teal-500/20 t-all"
            >
              <Icon name="list" className="w-4 h-4" /> {t('flatmates.seeAllAreasList', { count: selected.size })}
            </button>
          </>
        ) : (
          <>
            <h3 className="text-xl font-bold text-white">{t('flatmates.focusTitle')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
              {t('flatmates.focusIntroPre')} {kindText} {t('flatmates.focusIntroSuf')} <span className="text-teal-300 font-semibold">{maxAreas}</span>.
            </p>

            {visibleAreas.length ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {visibleAreas.map((a) => {
                  const on = selected.has(a.name);
                  return (
                    <button
                      key={a.name}
                      type="button"
                      data-sf-area={a.name}
                      onClick={() => onToggle(a.name)}
                      aria-pressed={on}
                      className={
                        'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium t-all ' +
                        (on
                          ? 'bg-teal-500/15 border-teal-400/40 text-teal-200'
                          : 'bg-white/5 border-white/10 text-gray-300 hover:border-teal-400/40 hover:text-white')
                      }
                    >
                      <Icon name="map-pin" className="w-3.5 h-3.5" /> {a.name}
                      <span className="text-[11px] text-gray-500">{a.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-gray-400">
                {t('flatmates.noKindMatchYet', { kind: kindText })}{' '}
                {filtersActive ? (
                  <button type="button" onClick={onClearFilters} className="text-teal-400 hover:text-teal-300 font-medium underline underline-offset-2">{t('flatmates.clearFilters')}</button>
                ) : t('flatmates.checkBackSoon')}
              </div>
            )}

            {/* Or narrow by proximity — precise, over per-post coordinates. */}
            <div className="mt-7 pt-6 border-t border-white/10 text-left">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                <Icon name="map-pinned" className="w-3.5 h-3.5 text-teal-300" /> {t('flatmates.orSearchNearPlace')}
              </p>
              <NearPlaceField filters={filters} setF={setF} />
            </div>

            <p className="mt-6 text-xs text-gray-600">
              {t('flatmates.preferEverythingPre')}{' '}
              <button type="button" onClick={onSwitchList} className="text-teal-400 hover:text-teal-300 font-medium underline underline-offset-2">{t('flatmates.viewList')}</button> {t('flatmates.preferEverythingSuf')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
