import '../../styles/routes/listings.css';
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { logSearchIntent } from '../../lib/mockApi.js';
import { listProperties } from '../../services/propertyService.js';
import { listLocalities } from '../../services/localityService.js';
import { useToast } from '../../context/ToastContext.jsx';
import { setLastSearch, getLastSearch } from '../../lib/store.js';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { buildAlertRecord } from './listings/alertCriteria.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';
import NewCityEmptyState from '../../components/city/NewCityEmptyState.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import useAsyncList from '../../hooks/useAsyncList.js';
import usePullToRefresh from '../../lib/usePullToRefresh.js';
import { useSocietyCatalogue } from '../../lib/useSocietyCatalogue.js';
import { enrichWithVerification } from '../../lib/data/enrichProperties.js';
import { allLocalities } from '../../data/localities.js';
import { allSocieties } from '../../data/societies.js';
import { enrichRent } from './listings/matchers.js';
import { INITIAL, serializeF, deserializeF, paramsToFilters, applyFiltersToSearchParams } from './listings/filterState.js';
import { canonicalTypeKey } from '../../data/propertyTypes.js';
import Filters from './listings/Filters.jsx';
import MobileFilterDrawer from './listings/MobileFilterDrawer.jsx';
import DealToggle from './listings/DealToggle.jsx';
import ResultsArea from './listings/ResultsArea.jsx';
import { computeResults } from './listings/listingsResultsPipeline.js';
import { buildActiveChips } from './listings/listingsChips.js';
import { parseSmartQuery } from './listings/listingsSmartQuery.js';

const SORTS = ['relevance', 'price-low', 'price-high', 'newest'];

/* The page's one remote read: the catalogue plus the locality registry, which are needed together
   before anything can be filtered. Hoisted out of the component so its identity is stable —
   `useAsyncList` re-runs on dep change, and an inline arrow would be a new loader every render. */
const loadCatalogue = () => Promise.all([listProperties({ includeAllStatuses: false }, 'newest'), listLocalities()]);

export default function Listings() {
  const { t: tr } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { create: createSavedSearch } = useSavedSearches();
  const { user, isIn } = useAuth();
  const { flagEnabled } = useAppFlags();

  // URL param compat: ?type= / ?ptype= accept one or more canonical type keys
  // (comma-separated) or legacy labels; ?deal=rent|buy is honoured directly.
  const urlTypeRaw = params.get('ptype') || params.get('type') || '';
  const urlTypeKeys = urlTypeRaw.split(',').map(canonicalTypeKey).filter(Boolean);
  const urlQ = (params.get('q') || params.get('locality') || '').toLowerCase();
  const urlSharing = params.get('sharing') || '';
  // Deal resolution: an explicit ?deal= always wins (so a PG / Hostel listed for
  // sale opens on the Buy tab). Otherwise share-only signals (flatmates, pg,
  // ?sharing=) default to Rent, since those products are predominantly rentals.
  const dealParam = params.get('deal');
  const urlDeal = dealParam === 'rent' || dealParam === 'buy'
    ? dealParam
    : (urlTypeKeys.includes('flatmates') || urlTypeKeys.includes('pg') || urlSharing ? 'rent' : 'buy');

  // Build the full initial filter state from the URL — all filters round-trip
  // through the address bar so a search is shareable, refresh-safe and
  // back-button-safe (see filterState.js).
  const buildInitial = () => paramsToFilters(params, urlDeal);

  const [f, setF] = useState(buildInitial);
  const [sort, setSort] = useState(() => (SORTS.includes(params.get('sort')) ? params.get('sort') : 'relevance'));
  const [page, setPage] = useState(1);
  const [view, setView] = useState(params.get('view') === 'map' ? 'map' : params.get('view') === 'list' ? 'list' : 'grid');
  const [activeId, setActiveId] = useState(params.get('property') || null);
  /* The catalogue read, with a lifecycle instead of a hope (D166). It used to be a bare
     `.then()` with no `.catch`: a failed read left `loaded` false forever, so the most-visited
     page in the app answered a dropped connection with six skeleton cards that never resolved,
     and the rejection went to the console. `useAsyncList` gives the failure a name and a retry. */
  const [catalogue, loadStatus, , retryLoad, loadError, refreshCatalogue] = useAsyncList(loadCatalogue, []);
  /* Pull down from the top of the results to re-read the catalogue. `refresh` rather than
     `retryLoad` because the latter flips the list back to `loading` — right for an error state's
     retry button, wrong here, where it would replace the results the user is looking at with
     skeletons. It is the hook's own refresh rather than `loadCatalogue().then(setCatalogue)` so
     the pull is sequenced against the effect's read: an outside refresh can be overtaken by an
     earlier load that settles later, and an earlier load that *fails* later would wipe the freshly
     pulled results into an error screen. */
  const ptr = usePullToRefresh(refreshCatalogue);
  const all = useMemo(
    () => (catalogue[0] || []).map((p) => enrichWithVerification(enrichRent(p))),
    [catalogue],
  );
  const loaded = loadStatus === 'ready';
  // Active city: we only have inventory for Pune today, so a data-less live city gets an
  // honest empty state here instead of Pune listings mislabelled as its own.
  const { city } = useCity();
  const hasData = cityHasData(city);
  const [localities, setLocalities] = useState([]);
  const [drawer, setDrawer] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const set = (patch) => startTransition(() => setF((prev) => ({ ...prev, ...patch })));
  const clearAll = () => setF(INITIAL(f.deal));
  // Rent/Buy switch: reset to that deal's default filter set (the two journeys have
  // different filter shapes) and drop back to page 1 / relevance. The state->URL
  // effect mirrors deal= to the address bar, so the switch stays shareable.
  const switchDeal = (deal) => {
    if (deal === f.deal) return;
    startTransition(() => { setF(INITIAL(deal)); setSort('relevance'); setPage(1); });
  };

  // Map search can be turned off by feature flag. When it is, a `view=map` deep-link
  // must not leave the user staring at a blank map — fall back to grid and surface a note.
  const mapEnabled = flagEnabled('mapSearch');
  const effView = view === 'map' && !mapEnabled ? 'grid' : view;

  // Return-to-search: restore the exact prior listings view (map + areas + filters +
  // open property + scroll) when the property page sends the user "back to map".
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!location.state?.restore) return;
    const snap = getLastSearch();
    if (!snap) return;
    if (snap.filters) setF(deserializeF(snap.filters));
    if (snap.view) setView(snap.view);
    if (snap.activeId) setActiveId(snap.activeId);
    if (snap.scrollY != null) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, snap.scrollY)));
  }, [location.state]);

  // The canonical return URL (deal + view + areas + open property) that we mirror to
  // the address bar and hand to the property page so its "Back to map" is one click.
  const buildReturnSearch = () => {
    const sp = new URLSearchParams();
    sp.set('deal', f.deal);
    sp.set('view', view);
    const locs = [...f.localities];
    if (locs.length) sp.set('loc', locs.join(','));
    const socs = [...f.societies];
    if (socs.length) sp.set('soc', socs.join(','));
    if (activeId) sp.set('property', activeId);
    return '/listings?' + sp.toString();
  };

  // Save the full context (incl. non-URL filters) so the return is lossless even after
  // a refresh on the property page.
  const saveReturnContext = () => setLastSearch({ search: buildReturnSearch(), filters: serializeF(f), view, activeId, scrollY: window.scrollY });

  const onSelectProperty = (id) => setActiveId(id);
  const onCloseProperty = () => setActiveId(null);

  // State -> URL sync: mirror the full filter set (plus deal/view/sort/open
  // property) to the address bar so a search is shareable, refresh-safe and
  // back-button-safe. Only writes when the query string actually changes, to
  // avoid redundant history churn / render loops.
  useEffect(() => {
    const next = applyFiltersToSearchParams(params, f);
    next.set('deal', f.deal);
    if (effView === 'grid') next.delete('view'); else next.set('view', effView);
    if (sort === 'relevance') next.delete('sort'); else next.set('sort', sort);
    if (activeId) next.set('property', activeId); else next.delete('property');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effView, sort, f, activeId]);

  // keep deal in sync with URL changes
  useEffect(() => { setF((prev) => (prev.deal === urlDeal ? prev : INITIAL(urlDeal))); }, [urlDeal]);

  useEffect(() => {
    const ls = catalogue[1];
    if (!ls) return;
    // Offer the full canonical registry (curated + community) as filter options,
    // not just the handful of listing-derived localities — so any Pune locality is
    // searchable here even without the Maps SDK loaded (list view). Live Places
    // suggestions layer on top of this in the Localities filter.
    const seen = new Set(ls.map((l) => l.slug));
    const merged = [...ls];
    allLocalities().forEach((l) => { if (l.slug && !seen.has(l.slug)) { merged.push({ slug: l.slug, name: l.name }); seen.add(l.slug); } });
    setLocalities(merged);
  }, [catalogue]);

  // A live Places pick can resolve to a locality that isn't in the option list yet;
  // register it (slug → name) so its chip and the dropdown summary show a friendly name.
  const addLocalityOption = useCallback(({ slug, name }) => {
    if (!slug) return;
    setLocalities((prev) => (prev.some((l) => l.slug === slug) ? prev : [...prev, { slug, name: name || slug }]));
  }, []);

  const locNameBySlug = useMemo(() => Object.fromEntries(localities.map((l) => [l.slug, l.name])), [localities]);
  // A `?society=` filter can name any of the 348 rows, so the chip label needs the
  // whole catalogue — not the 28 readable before the bulk chunk lands (D129).
  const catalogueReady = useSocietyCatalogue();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `catalogueReady` is an invalidation signal for the module-level society store, which the rule cannot see. See `lib/useSocietyCatalogue.js`.
  const socNameBySlug = useMemo(() => Object.fromEntries(allSocieties().map((s) => [s.slug, s.name])), [catalogueReady]);

  // Deferred filter state — keeps inputs responsive while heavy results recompute in background
  const deferredF = useDeferredValue(f);

  const resultsData = useMemo(
    () => computeResults({ all, df: deferredF, sort, urlQ, locNameBySlug, tr }),
    [all, deferredF, sort, urlQ, locNameBySlug, tr],
  );
  const results = resultsData.list;
  const relaxedNear = resultsData.relaxedNear;
  // E2 (ADR-019): verified-supply social proof across the full result set (not just the page).
  const verifiedCount = useMemo(
    () => results.filter((p) => p.ownerVerified || p.ownershipVerified).length,
    [results],
  );

  // Client-side pagination — grid/list views page through results 9 at a time.
  // Map view is different: plotting an entire city of markers is expensive (and, with
  // a real API, a heavy fetch), so it is "area-first" — it only renders once the user
  // has focused on 1–MAP_MAX_AREAS localities, and even then caps markers at
  // MAP_MARKER_CAP. Page resets to 1 whenever the result set changes.
  const PAGE_SIZE = 9;
  const MAP_MARKER_CAP = 120;
  const MAP_MAX_AREAS = 5;
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const mapAreaCount = f.localities.size;
  const mapGated = effView === 'map' && (mapAreaCount === 0 || mapAreaCount > MAP_MAX_AREAS);

  // Registry centres for the selected localities. The map fits to its property
  // markers, but a low/zero-inventory locality has none — so we hand it these
  // coords to focus on the chosen area instead of sitting at the city default
  // (which made a freshly-selected locality look like a broken/empty map).
  const locSig = [...f.localities].sort().join(',');
  const mapFocus = useMemo(() => {
    if (!f.localities.size) return [];
    return allLocalities()
      .filter((l) => f.localities.has(l.slug) && l.lat != null && l.lng != null)
      .map((l) => [l.lat, l.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locSig]);

  let pageResults;
  if (effView === 'map') {
    pageResults = mapGated ? [] : results.slice(0, MAP_MARKER_CAP);
  } else {
    pageResults = results.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  }
  const activeIndex = activeId ? pageResults.findIndex((p) => p.id === activeId) : -1;
  const activeProperty = activeIndex >= 0 ? pageResults[activeIndex] : null;
  useEffect(() => { setPage(1); }, [deferredF, sort, urlQ]);
  const goToPage = (n) => {
    setPage(Math.min(Math.max(1, n), pageCount));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Passive search intent logging — fires when user changes filters
  const intentLogged = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const loc = deferredF.localities.size === 1 ? [...deferredF.localities][0] : '';
    const bhk = deferredF.bhk.size === 1 ? [...deferredF.bhk][0] : '';
    const key = `${loc}|${deferredF.deal}|${bhk}`;
    if (key === intentLogged.current || (!loc && !bhk)) return;
    intentLogged.current = key;
    const locName = loc ? (locNameBySlug[loc] || loc) : '';
    logSearchIntent({ locality: locName, deal: deferredF.deal, bhk, userId: user?.mobile || 'anon' });
  }, [deferredF, loaded]);

  const activeChips = useMemo(
    () => buildActiveChips(f, { tr, locNameBySlug, socNameBySlug, setF, set }),
    [f, locNameBySlug, socNameBySlug, tr],
  );

  const smartSearch = () => {
    const parsed = parseSmartQuery(aiQuery, { fallbackDeal: f.deal, localities, locNameBySlug });
    if (!parsed) return;
    setF(parsed.next);
    navigate(`/listings?deal=${parsed.deal}`);
    toast(tr('listings.smartSearchToast', { detail: parsed.parts.join(' · ') }), 'success');
  };

  const saveSearch = () => {
    // Alerts live in the login-only dashboard and are keyed by mobile, so a search
    // saved while signed out would be orphaned under 'anon' and never surface there.
    // Gate on auth (matching the save-property flow) so alerts always reach the dashboard.
    if (!isIn) {
      navigate(`/signin?reason=alerts&next=${encodeURIComponent('/listings?deal=' + f.deal)}`);
      return;
    }
    // If the box has a typed query, parse it so the saved criteria match the label/text
    // (and apply it to the results) — no more "label says X but filters say Y" mismatch.
    const typed = aiQuery.trim();
    const parsed = typed ? parseSmartQuery(aiQuery, { fallbackDeal: f.deal, localities, locNameBySlug }) : null;
    if (parsed) {
      setF(parsed.next);
      navigate(`/listings?deal=${parsed.deal}`);
    }
    const record = buildAlertRecord(parsed ? parsed.next : f, locNameBySlug);
    createSavedSearch({ ...record, label: typed || record.label, query: typed });
    toast(tr('listings.searchSavedToast'), 'success');
  };
  return (
    <>
      <MobileFilterDrawer drawer={drawer} setDrawer={setDrawer} f={f} set={set} localities={localities} onAddLocality={addLocalityOption} clearAll={clearAll} total={results.length} />

      {/* Own top offset (this route is selfPadded), derived from the navbar token plus
          a breathing gap rather than restating the bar's height. The gaps make ≥768px
          resolve to the 92px it hardcoded before; phones inherit the shorter bar. */}
      <div ref={ptr.ref} className="pt-[calc(var(--pn-nav-h)+8px)] sm:pt-[calc(var(--pn-nav-h)+20px)] pb-20">
        {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
          <div
            aria-hidden="true"
            className="glass-strong pointer-events-none fixed left-1/2 z-40 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
            style={{ top: `calc(var(--pn-nav-h) + ${Math.round(ptr.pullDistance)}px)`, opacity: 0.4 + ptr.progress * 0.6 }}
          >
            <Icon
              name={ptr.isRefreshing ? 'loader-2' : 'chevron-down'}
              className={'w-4 h-4 text-teal-400' + (ptr.isRefreshing ? ' animate-spin' : '')}
              style={ptr.isRefreshing ? undefined : { transform: `rotate(${ptr.progress * 180}deg)` }}
            />
          </div>
        )}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="hidden sm:flex items-center gap-2 text-sm mb-3 list-reveal" style={{ animationDelay: '0ms' }}>
            <Link to="/" className="text-gray-500 hover:text-teal-400 t-all flex items-center gap-1"><Icon name="home" className="w-3.5 h-3.5" /> {tr('listings.breadcrumbHome')}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-gray-600" />
            <span className="text-gray-300" aria-current="page">{f.deal === 'rent' ? tr('listings.titleForRent', { city }) : tr('listings.titleForSale', { city })}</span>
          </nav>

          {/* One row at every width. The toggle used to be a full-bleed bar stacked under
              the heading, which spent ~90px of first-viewport height on two words and a
              lot of empty pill. It now hugs its labels and sits beside a shortened
              phone-width heading — the full "Properties for …" wording returns at sm,
              where there is room for it. */}
          <div className="flex flex-row items-center justify-between gap-2.5 sm:gap-3 mb-3.5 sm:mb-5 list-reveal" style={{ animationDelay: '60ms' }}>
            <h1 className="min-w-0 text-3xl font-bold text-white leading-tight">
              <span className="sm:hidden">{f.deal === 'rent' ? tr('listings.titleShortForRent', { city }) : tr('listings.titleShortForSale', { city })}</span>
              <span className="hidden sm:inline">{f.deal === 'rent' ? tr('listings.titleForRent', { city }) : tr('listings.titleForSale', { city })}</span>
            </h1>
            {hasData ? <DealToggle deal={f.deal} onChange={switchDeal} className="shrink-0 lg:hidden" /> : null}
          </div>

          {/* The Rent tab used to carry a "Looking to share? Browse flatmates & rooms"
              pill here. Flatmates is now a permanent slot in the mobile bottom nav, so
              the pill was a second entry point to a destination already one tap away —
              and it pushed the first result card further below the fold. */}

          {!hasData ? (
            <div className="py-10 sm:py-16">
              <NewCityEmptyState city={city} context="listings" />
            </div>
          ) : (
          <div className="flex gap-8">
            <aside className="hidden lg:block w-[300px] min-w-[300px] list-reveal" style={{ animationDelay: '120ms' }}>
              <div className="glass rounded-2xl p-6 sticky top-28 max-h-[calc(100vh-9rem)] overflow-y-auto filter-scroll">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icon name="sliders-horizontal" className="w-5 h-5 text-teal-400" /> {tr('listings.filters')}</h3>
                  <button onClick={clearAll} className="text-xs font-medium text-teal-400 hover:text-teal-300 t-all">{tr('listings.clearAll')}</button>
                </div>
                <Filters f={f} set={set} localities={localities} onAddLocality={addLocalityOption} clearAll={clearAll} showClear={false} />
              </div>
            </aside>

            <ResultsArea f={f} set={set} localities={localities} aiQuery={aiQuery} setAiQuery={setAiQuery} smartSearch={smartSearch} saveSearch={saveSearch} results={pageResults} total={results.length} verifiedCount={verifiedCount} relaxedNear={relaxedNear} page={safePage} pageCount={pageCount} goToPage={goToPage} view={effView} setView={setView} sort={sort} setSort={setSort} flagEnabled={flagEnabled} activeChips={activeChips} clearAll={clearAll} locNameBySlug={locNameBySlug} loaded={loaded} loadFailed={loadStatus === 'error'} loadError={loadError} onRetryLoad={retryLoad} toast={toast} onOpenFilters={() => setDrawer(true)} mapGated={mapGated} mapAreaCount={mapAreaCount} mapMaxAreas={MAP_MAX_AREAS} mapMarkerCap={MAP_MARKER_CAP} mapFocus={mapFocus} activeId={activeId} activeProperty={activeProperty} activeIndex={activeIndex} onSelectProperty={onSelectProperty} onCloseProperty={onCloseProperty} fromSearch={buildReturnSearch()} onOpenProperty={saveReturnContext} isIn={isIn} mapUnavailable={view === 'map' && !mapEnabled} />
          </div>
          )}
        </div>
      </div>
    </>
  );
}
