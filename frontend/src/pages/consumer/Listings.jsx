import '../../styles/routes/listings.css';
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { recordSignal } from '../../services/demandService.js';
import { listLocalities } from '../../services/localityService.js';
import { useToast } from '../../context/ToastContext.jsx';
import { setLastSearch, getLastSearch } from '../../lib/localPrefs.js';
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
import { allLocalities } from '../../data/localities.js';
import { allSocieties } from '../../data/societies.js';
import { toFacetQuery } from '../../lib/listings/facetQuery.js';
import { INITIAL, serializeF, deserializeF, paramsToFilters, applyFiltersToSearchParams } from '../../lib/listings/filterState.js';
import { canonicalTypeKey } from '../../data/propertyTypes.js';
import Filters from './listings/Filters.jsx';
import MobileFilterDrawer from './listings/MobileFilterDrawer.jsx';
import DealToggle from './listings/DealToggle.jsx';
import ResultsArea from './listings/ResultsArea.jsx';
import useListingsSearch from './listings/useListingsSearch.js';
import { buildActiveChips } from './listings/listingsChips.js';
import { parseSmartQuery } from './listings/listingsSmartQuery.js';

const SORTS = ['relevance', 'price-low', 'price-high', 'newest'];

/* Rows per request. The grid asks for a page; the map asks for as many pins as it is willing to
   draw, because a map with a "next page" button is not a map. Both are the server's problem now —
   the page used to slice a 100-row prefetch, so `PAGE_SIZE = 9` silently meant "9 of the first
   100 listings in the city" rather than 9 of the ones that matched. */
const PAGE_SIZE = 24;
/* 100 is the server's ceiling (`spring.data.web.pageable.max-page-size`), not a taste judgement.
   Asking for more is silently clamped, which would leave the "showing the first N" note quoting a
   number of pins the map never drew. */
const MAP_MARKER_CAP = 100;
const MAP_MAX_AREAS = 5;

/* The locality registry: filter options, chip labels and the map's fallback focus. Hoisted so its
   identity is stable — `useAsyncList` re-runs on dep change and an inline arrow would be a new
   loader every render. The listings themselves are no longer read here; see `useListingsSearch`. */
const loadLocalities = () => listLocalities();

export default function Listings() {
  const { t: tr } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { create: createSavedSearch } = useSavedSearches();
  // `user` was read only to stamp a demand signal with `user?.mobile || 'anon'`. The server takes
  // the session from the token now, so the page no longer needs to know who is signed in to
  // measure demand.
  const { isIn } = useAuth();
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
  /* The locality registry, with a lifecycle instead of a hope (D166). It used to be a bare
     `.then()` with no `.catch`: a failed read left `loaded` false forever, so the most-visited
     page in the app answered a dropped connection with six skeleton cards that never resolved,
     and the rejection went to the console. `useAsyncList` gives the failure a name and a retry. */
  const [localityRows] = useAsyncList(loadLocalities, []);
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
    const ls = localityRows;
    if (!ls.length) return;
    // Offer the full canonical registry (curated + community) as filter options,
    // not just the handful of listing-derived localities — so any Pune locality is
    // searchable here even without the Maps SDK loaded (list view). Live Places
    // suggestions layer on top of this in the Localities filter.
    const seen = new Set(ls.map((l) => l.slug));
    const merged = [...ls];
    allLocalities().forEach((l) => { if (l.slug && !seen.has(l.slug)) { merged.push({ slug: l.slug, name: l.name }); seen.add(l.slug); } });
    setLocalities(merged);
  }, [localityRows]);

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

  // Deferred filter state — keeps the inputs responsive while the request for the new results is
  // in flight, so a checkbox never waits on the network to look checked.
  const deferredF = useDeferredValue(f);

  // Map view is "area-first": plotting a whole city is a heavy read and an unreadable map, so it
  // only draws once the user has focused on 1–MAP_MAX_AREAS localities, and asks for at most
  // MAP_MARKER_CAP pins. Grid and list ask for one ordinary page.
  const mapAreaCount = f.localities.size;
  const mapGated = effView === 'map' && (mapAreaCount === 0 || mapAreaCount > MAP_MAX_AREAS);
  const size = effView === 'map' ? MAP_MARKER_CAP : PAGE_SIZE;

  const query = useMemo(
    () => (hasData && !mapGated ? toFacetQuery(deferredF, { sort, q: urlQ }) : null),
    [hasData, mapGated, deferredF, sort, urlQ],
  );
  /* The near-search recovery, as a second query rather than a second pass over a list we happened
     to already have. Only built when the two location filters can actually contradict each other:
     a map pin plus an explicit locality selection. */
  const relaxedQuery = useMemo(
    () => (query && deferredF.near && deferredF.localities.size
      ? toFacetQuery(deferredF, { sort, q: urlQ, dropLocalities: true })
      : null),
    [query, deferredF, sort, urlQ],
  );

  /* Reset to page 1 when the search itself changes — during render, not in an effect. An effect
     would fire the request for page 7 of the old search first and then immediately supersede it,
     paying for a round trip whose results can never be shown. */
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const [pagedQueryKey, setPagedQueryKey] = useState(queryKey);
  if (pagedQueryKey !== queryKey) {
    setPagedQueryKey(queryKey);
    if (page !== 1) setPage(1);
  }
  const requestPage = pagedQueryKey === queryKey ? page : 1;

  const search = useListingsSearch({ query, relaxedQuery, page: requestPage, size });
  const results = search.data.items;
  const total = search.data.total;
  // E2 (ADR-019): verified-supply social proof across the whole result set. This is a server count
  // — the browser can only see one page, and counting the badges on it would answer "how many of
  // these 24" while reading as "how many in Baner".
  const verifiedCount = search.data.verifiedTotal;
  const relaxedNear = search.relaxed
    ? { locNames: [...deferredF.localities].map((s) => locNameBySlug[s] || s), nearLabel: deferredF.nearLabel || tr('listings.thePlace') }
    : null;
  /* "Loaded" means there is a real answer to render, which is not the same as "not loading": a
     failed read is settled and has nothing to show, and printing "Showing 0 properties" for it
     would be a claim about Pune's inventory rather than about the request (D166). Holding the
     previous page through a refinement is what keeps the list from flashing skeletons between two
     nearly identical result sets — and the count beside it stays truthful because it came off the
     same response as the rows it is counting. */
  const loaded = search.status === 'ready' || results.length > 0;
  const pageCount = Math.max(1, search.data.pageCount || 1);
  const safePage = Math.min(requestPage, pageCount);

  /* Pull down from the top of the results to re-run the search. It re-runs rather than resetting
     to `loading` so the results the user is looking at stay on screen while the fresh ones are
     fetched, and it goes through the hook so the pull is sequenced against the in-flight read —
     an outside refresh can otherwise be overtaken by an earlier request that settles later. */
  const ptr = usePullToRefresh(search.refresh);

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

  // The server already returned exactly one page (or, for the map, one capped batch), so there is
  // nothing left to slice here. `mapGated` suspends the request entirely rather than fetching a
  // batch the map has decided not to draw.
  const pageResults = mapGated ? [] : results;
  const activeIndex = activeId ? pageResults.findIndex((p) => p.id === activeId) : -1;
  const activeProperty = activeIndex >= 0 ? pageResults[activeIndex] : null;
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
    // The slug, not the display name. This used to send `locNameBySlug[loc] || loc`, which meant
    // the demand table was keyed on whatever the label happened to be that day; the server joins
    // to `localities` on the slug and resolves the name itself.
    //
    // No `userId` either. It used to send `user?.mobile || 'anon'`, so every signed-out searcher
    // shared one identity and three strangers looked like one repeat visitor. The server reads the
    // session from the token if there is one and records nothing if there is not.
    //
    // Not awaited, and deliberately not caught here: `recordSignal` never rejects. A telemetry
    // write must not be able to break a search.
    recordSignal({ kind: 'search', localitySlug: loc, deal: deferredF.deal, bhk });
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
      <MobileFilterDrawer drawer={drawer} setDrawer={setDrawer} f={f} set={set} localities={localities} onAddLocality={addLocalityOption} clearAll={clearAll} total={total} />

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

            <ResultsArea f={f} set={set} localities={localities} aiQuery={aiQuery} setAiQuery={setAiQuery} smartSearch={smartSearch} saveSearch={saveSearch} results={pageResults} total={total} verifiedCount={verifiedCount} relaxedNear={relaxedNear} page={safePage} pageCount={pageCount} goToPage={goToPage} view={effView} setView={setView} sort={sort} setSort={setSort} flagEnabled={flagEnabled} activeChips={activeChips} clearAll={clearAll} locNameBySlug={locNameBySlug} loaded={loaded} loadFailed={search.status === 'error'} searching={search.status === 'loading'} loadError={search.error} onRetryLoad={search.retry} toast={toast} onOpenFilters={() => setDrawer(true)} mapGated={mapGated} mapAreaCount={mapAreaCount} mapMaxAreas={MAP_MAX_AREAS} mapMarkerCap={MAP_MARKER_CAP} mapFocus={mapFocus} activeId={activeId} activeProperty={activeProperty} activeIndex={activeIndex} onSelectProperty={onSelectProperty} onCloseProperty={onCloseProperty} fromSearch={buildReturnSearch()} onOpenProperty={saveReturnContext} isIn={isIn} mapUnavailable={view === 'map' && !mapEnabled} />
          </div>
          )}
        </div>
      </div>
    </>
  );
}
