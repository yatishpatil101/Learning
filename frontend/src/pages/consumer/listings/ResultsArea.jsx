import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import Card from './Card.jsx';
import NotifyMeCard from './NotifyMeCard.jsx';
import MapGate from './MapGate.jsx';
import Select from '../../../components/ui/Select.jsx';
import Button from '../../../components/ui/Button.jsx';
import { shareFlatUrl } from './matchers.js';
import { RANGE } from './filterState.js';

const PropertyMap = lazy(() => import('../../../components/property/PropertyMap.jsx'));
const MapDetailPanel = lazy(() => import('../../../components/property/MapDetailPanel.jsx'));

/* Compact page-number model with leading/trailing ellipses: always shows the
   first & last page, the current page and its neighbours, collapsing the rest. */
function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  const items = [1];
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

export default function ResultsArea({ f, set, localities, aiQuery, setAiQuery, smartSearch, saveSearch, results, total, verifiedCount = 0, relaxedNear, page, pageCount, goToPage, view, setView, sort, setSort, flagEnabled, activeChips, clearAll, locNameBySlug, loaded, toast, onOpenFilters, mapGated, mapAreaCount, mapMaxAreas, mapMarkerCap, mapFocus, activeId, activeProperty, activeIndex, onSelectProperty, onCloseProperty, fromSearch, onOpenProperty, isIn, mapUnavailable }) {
  const { t } = useTranslation();
  const count = total ?? results.length;
  const mapCapped = view === 'map' && !mapGated && total > results.length;
  // Empty-state "broaden" shortcuts: offer to relax whichever narrowing filters
  // are actually active, so a dead-end search has a one-tap path back to results
  // (better funnel than only "clear everything").
  const isRent = f.deal === 'rent';
  const broadeners = [];
  if (f.localities.size) broadeners.push({ id: 'loc', label: t('listings.broadenAllLocalities'), apply: () => set({ localities: new Set() }) });
  if (isRent && (f.rent[0] !== RANGE.rent[0] || f.rent[1] !== RANGE.rent[1])) broadeners.push({ id: 'rent', label: t('listings.broadenRent'), apply: () => set({ rent: [...RANGE.rent] }) });
  if (!isRent && (f.budget[0] !== RANGE.budget[0] || f.budget[1] !== RANGE.budget[1])) broadeners.push({ id: 'budget', label: t('listings.broadenBudget'), apply: () => set({ budget: [...RANGE.budget] }) });
  if (f.bhk.size) broadeners.push({ id: 'bhk', label: t('listings.broadenAnyBhk'), apply: () => set({ bhk: new Set() }) });
  if (f.types.size) broadeners.push({ id: 'type', label: t('listings.broadenAnyType'), apply: () => set({ types: new Set(), commercialTypes: new Set() }) });

  const filtersBtn = (
    <button
      type="button"
      onClick={onOpenFilters}
      className="lg:hidden inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border border-teal-400/40 bg-teal-500/15 text-teal-100 text-sm font-semibold hover:bg-teal-500/25 hover:border-teal-400/60 t-all shrink-0"
    >
      <Icon name="sliders-horizontal" className="w-4 h-4" /> {t('listings.filters')}
      {activeChips.length ? (
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-teal-400 text-gray-900 text-[10px] font-bold leading-none">{activeChips.length}</span>
      ) : null}
    </button>
  );

  const viewToggles = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <span className="text-xs text-gray-500 mr-1 hidden sm:inline">{t('listings.viewLabel')}</span>
      <button onClick={() => setView('grid')} aria-pressed={view === 'grid'} className={'view-btn w-9 h-9 sm:w-10 sm:h-10 rounded-lg border border-white/10 flex items-center justify-center t-all' + (view === 'grid' ? ' active' : ' text-gray-500')} title={t('listings.gridView')}><Icon name="layout-grid" className="w-4 h-4" /></button>
      <button onClick={() => setView('list')} aria-pressed={view === 'list'} className={'view-btn w-9 h-9 sm:w-10 sm:h-10 rounded-lg border border-white/10 flex items-center justify-center t-all' + (view === 'list' ? ' active' : ' text-gray-500')} title={t('listings.listView')}><Icon name="list" className="w-4 h-4" /></button>
      {flagEnabled('mapSearch') && <button onClick={() => setView('map')} aria-pressed={view === 'map'} className={'view-btn w-9 h-9 sm:w-10 sm:h-10 rounded-lg border border-white/10 flex items-center justify-center t-all' + (view === 'map' ? ' active' : ' text-gray-500')} title={t('listings.mapView')}><Icon name="map" className="w-4 h-4" /></button>}
    </div>
  );

  const sortSelect = (
    <Select
      value={sort}
      onChange={setSort}
      options={[
        { value: 'relevance', label: t('listings.sortRelevance') },
        { value: 'price-low', label: t('listings.sortPriceLow') },
        { value: 'price-high', label: t('listings.sortPriceHigh') },
        { value: 'newest', label: t('listings.sortNewest') },
      ]}
      className="w-[116px] sm:w-40"
      ariaLabel={t('listings.sortAria')}
    />
  );

  const countLine = loaded ? (
    <p className="text-gray-400 text-sm">{t('listings.showing')} <span className="text-teal-400 font-semibold">{count}</span> {t('listings.propertyNoun', { count })}
      {verifiedCount > 0 ? <span className="text-emerald-300/90"> · <Icon name="shield-check" className="w-3.5 h-3.5 inline-block -mt-0.5" /> {t('listings.verifiedCount', { count: verifiedCount })}</span> : null}
    </p>
  ) : (
    <p className="text-gray-400 text-sm inline-flex items-center gap-2" aria-live="polite">
      <span className="w-3.5 h-3.5 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" /> {t('listings.searchingCity')}
    </p>
  );

  return (
            <div className="flex-1 min-w-0">
              <div className="mb-3.5 sm:mb-5 list-reveal" style={{ animationDelay: '120ms' }}>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Icon name="sparkles" className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input type="text" value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') smartSearch(); }} placeholder={f.deal === 'rent' ? t('listings.smartPlaceholderRent') : t('listings.smartPlaceholderBuy')} className="w-full pl-9 pr-[76px] sm:pr-3 h-10 rounded-xl glass border border-white/10 text-sm text-white placeholder-gray-500 focus:border-teal-400/50 outline-none bg-white/5" />
                    {/* Mobile: inline save + submit icons keep smart search to a single row */}
                    <div className="sm:hidden absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button type="button" onClick={saveSearch} aria-label={t('listings.saveSearch')} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-teal-300 hover:bg-white/5 t-all"><Icon name="bell-plus" className="w-4 h-4" /></button>
                      <button type="button" onClick={smartSearch} aria-label={t('listings.smartSearch')} className="w-8 h-8 rounded-lg btn-primary flex items-center justify-center"><Icon name="search" className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="hidden sm:flex gap-2">
                    <Button onClick={smartSearch} variant="primary" icon="search">{t('listings.smartSearch')}</Button>
                    <Button onClick={saveSearch} variant="secondary" icon="bell-plus" aria-label={t('listings.saveSearch')}><span className="hidden sm:inline">{t('listings.saveSearch')}</span></Button>
                  </div>
                </div>
              </div>

              {/* Phones: count scrolls away; the compact controls bar is a direct child of
                  the (tall) results column so it stays stuck under the header across the
                  whole list — a short wrapper would cap its sticky travel. */}
              <div className="sm:hidden mb-2 list-reveal" style={{ animationDelay: '180ms' }}>{countLine}</div>
              <div className="sm:hidden sticky top-[64px] z-30 -mx-4 mb-3.5 px-4 py-2 flex items-center gap-2 bg-[#0d0b1a]/85 backdrop-blur border-b border-white/5">
                {filtersBtn}
                <div className="ml-auto flex items-center gap-2">
                  {viewToggles}
                  {sortSelect}
                </div>
              </div>

              {/* Tablet & desktop: single row — count left, controls right (unchanged). */}
              <div className="hidden sm:flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6 list-reveal" style={{ animationDelay: '180ms' }}>
                {countLine}
                <div className="flex items-center justify-end gap-3">
                  {filtersBtn}
                  <div className="flex items-center gap-3">
                    {viewToggles}
                    {sortSelect}
                  </div>
                </div>
              </div>

              {activeChips.length ? (
                <div className="flex flex-wrap items-center gap-2 mb-6 list-reveal" style={{ animationDelay: '200ms' }}>
                  <span className="text-xs text-gray-500 mr-0.5">{t('listings.activeFilters')}</span>
                  {activeChips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={c.remove}
                      aria-label={t('listings.removeFilter', { label: c.label })}
                      className="af-chip inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-teal-500/12 border border-teal-400/30 text-teal-200 text-xs font-medium hover:bg-teal-500/20 hover:border-teal-400/50 t-all"
                    >
                      {c.label}
                      <Icon name="x" className="w-3 h-3" />
                    </button>
                  ))}
                  <button type="button" onClick={clearAll} className="text-xs font-medium text-gray-400 hover:text-white underline underline-offset-2 ml-1">{t('listings.clearAllLower')}</button>
                </div>
              ) : null}

              {f.deal === 'rent' && f.types.has('flatmates') ? (
                <Link to={shareFlatUrl(f, locNameBySlug)} className="flex items-center gap-4 mb-6 rounded-2xl border border-teal-500/25 bg-gradient-to-r from-teal-500/10 to-teal-400/5 px-5 py-4 hover:border-teal-400/50 transition-all group">
                  <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0"><Icon name="users-round" className="w-5 h-5 text-teal-300" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-semibold text-sm">{t('listings.shareFlatTitle')}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{t('listings.shareFlatBrowse')} <span className="text-teal-300 font-medium">{t('listings.shareFlatRooms')}</span>{t('listings.shareFlatSplit')}</p>
                  </div>
                  <span className="flex-shrink-0 hidden sm:inline-flex items-center gap-1.5 text-teal-300 text-sm font-semibold group-hover:gap-2.5 transition-all">{t('listings.shareFlatCta')} <Icon name="arrow-right" className="w-4 h-4" /></span>
                </Link>
              ) : null}

              {relaxedNear ? (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-teal-400/25 bg-teal-500/[0.07] px-4 py-3 list-reveal" style={{ animationDelay: '160ms' }}>
                  <Icon name="map-pinned" className="w-4 h-4 text-teal-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-teal-100/90">
                    {t('listings.relaxedNearPre')} <span className="font-semibold text-white">{relaxedNear.locNames.join(', ')}</span> {t('listings.relaxedNearMid')} <span className="font-semibold text-white">{relaxedNear.nearLabel}</span> {t('listings.relaxedNearSuf')}
                    <button type="button" onClick={() => set({ localities: new Set() })} className="ml-2 font-medium text-teal-300 hover:text-teal-200 underline underline-offset-2">{t('listings.relaxedNearKeep', { label: relaxedNear.nearLabel })}</button>
                  </p>
                </div>
              ) : null}

              {mapUnavailable ? (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  <Icon name="info" className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-gray-300">{t('listings.mapUnavailable')}</p>
                </div>
              ) : null}

              {view === 'map' && flagEnabled('mapSearch') ? (
                mapGated ? (
                  <MapGate localities={localities} f={f} set={set} locNameBySlug={locNameBySlug} maxAreas={mapMaxAreas} setView={setView} />
                ) : (
                  <>
                    {mapCapped && (
                      <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3">
                        <Icon name="info" className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-100/90">
                          {t('listings.mapCappedPre')} <span className="font-semibold text-white">{results.length}</span> {t('listings.mapCappedMid')}{' '}
                          <span className="font-semibold text-white">{total}</span> {t('listings.mapCappedSuf')}
                        </p>
                      </div>
                    )}
                    <Suspense fallback={<div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" /></div>}>
                      <PropertyMap properties={results} locName={locNameBySlug} focus={mapFocus} activeId={activeId} onSelect={onSelectProperty} />
                    </Suspense>
                    {activeProperty ? (
                      <Suspense fallback={null}>
                        <MapDetailPanel
                          property={activeProperty}
                          list={results}
                          activeIndex={activeIndex}
                          locName={locNameBySlug}
                          onClose={onCloseProperty}
                          onSelect={onSelectProperty}
                          fromSearch={fromSearch}
                          onOpenFull={onOpenProperty}
                          scheduleEnabled={flagEnabled('scheduleVisit')}
                          chatEnabled={flagEnabled('inAppMessaging')}
                          isIn={isIn}
                          toast={toast}
                        />
                      </Suspense>
                    ) : null}
                  </>
                )
              ) : !loaded ? (
                <div className={view === 'list' ? 'flex flex-col gap-4' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="glass rounded-2xl overflow-hidden">
                      <div className="h-48 skeleton" />
                      <div className="p-4 space-y-3">
                        <div className="h-4 w-2/3 skeleton rounded" />
                        <div className="h-5 w-1/2 skeleton rounded" />
                        <div className="h-3 w-3/4 skeleton rounded" />
                        <div className="h-3 w-1/3 skeleton rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : count === 0 ? (
                <div className="glass rounded-2xl px-5 py-8 sm:p-12 text-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 sm:mb-4"><Icon name="search" className="w-6 h-6 sm:w-7 sm:h-7 text-gray-600" /></div>
                  <p className="text-white font-semibold mb-1">{t('listings.noPropertiesFound')}</p>
                  <p className="text-gray-500 text-sm mb-4 sm:mb-5">{broadeners.length ? t('listings.emptyTight') : t('listings.emptyAdjust')}</p>
                  {broadeners.length ? (
                    <div className="flex flex-wrap items-center justify-center gap-2 mb-4 sm:mb-5">
                      {broadeners.map((b) => (
                        <button key={b.id} type="button" onClick={b.apply} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-gray-200 hover:border-teal-400/40 hover:text-white hover:bg-teal-500/10 transition-all">
                          <Icon name="plus-circle" className="w-4 h-4 text-teal-400" /> {b.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div>
                    <button onClick={clearAll} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500/10 border border-teal-400/30 text-teal-300 text-sm font-medium hover:bg-teal-500/20 transition-all"><Icon name="x-circle" className="w-4 h-4" /> {t('listings.clearAllFiltersBtn')}</button>
                  </div>
                  <NotifyMeCard filters={f} locNameBySlug={locNameBySlug} toast={toast} />
                </div>
              ) : (
                <>
                  <div className={view === 'list' ? 'flex flex-col gap-4' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'}>
                    {results.map((p, i) => <Card key={p.id} p={p} index={i} list={view === 'list'} locName={locNameBySlug[p.localitySlug]} linkState={{ from: fromSearch, restore: true }} onOpen={onOpenProperty} />)}
                  </div>
                  {results.length > 0 && count < 3 && (
                    <NotifyMeCard filters={f} locNameBySlug={locNameBySlug} toast={toast} />
                  )}
                </>
              )}

              {view !== 'map' && pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-12">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  aria-label={t('listings.prevPage')}
                  className="page-btn text-gray-500 border border-white/10 hover:border-teal-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10"
                ><Icon name="chevron-left" className="w-4 h-4" /></button>
                {pageItems(page, pageCount).map((it, i) =>
                  it === '…' ? (
                    <span key={`gap-${i}`} className="text-gray-600 px-1">…</span>
                  ) : (
                    <button
                      key={it}
                      onClick={() => goToPage(it)}
                      aria-label={t('listings.pageN', { n: it })}
                      aria-current={it === page ? 'page' : undefined}
                      className={it === page ? 'page-btn active border border-transparent' : 'page-btn text-gray-400 border border-white/10 hover:border-teal-500/40'}
                    >{it}</button>
                  ),
                )}
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= pageCount}
                  aria-label={t('listings.nextPage')}
                  className="page-btn text-gray-500 border border-white/10 hover:border-teal-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10"
                ><Icon name="chevron-right" className="w-4 h-4" /></button>
              </div>
              )}
            </div>
  );
}
