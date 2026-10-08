import '../../styles/routes/filters.css';
import '../../styles/routes/listings.css';
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { recordSignal } from '../../services/demandService.js';
import { getLocality, listLocalities } from '../../services/localityService.js';
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
import { useSignInGate } from '../../lib/useSignInGate.js';
import { getSociety } from '../../services/societyService.js';
import { toFacetQuery } from '../../lib/listings/facetQuery.js';
import { INITIAL, serializeF, deserializeF, paramsToFilters, applyFiltersToSearchParams, switchDealFilters, hasFilterParams } from '../../lib/listings/filterState.js';
import { clampNearRadius, nearMaxFor } from '../../lib/nearParams.js';
import { canonicalTypeKey } from '../../data/propertyTypes.js';
import Filters from './listings/Filters.jsx';
import MobileFilterDrawer from './listings/MobileFilterDrawer.jsx';
import DealToggle from './listings/DealToggle.jsx';
import ResultsArea from './listings/ResultsArea.jsx';
import useListingsSearch from './listings/useListingsSearch.js';
import { buildActiveChips } from './listings/listingsChips.js';
import { parseSmartQuery } from './listings/listingsSmartQuery.js';

const SORTS = ['relevance', 'price-low', 'price-high', 'newest', 'price-psf', 'verified'];

/* The grid asks for a page; the map asks for as many pins as it will draw, because a map with a
 * "next page" button is not a map. */
const PAGE_SIZE = 24;
/* 100 is the server's ceiling (`spring.data.web.pageable.max-page-size`) and asking for more is silently clamped,
   which would leave the "showing the first N" note quoting pins never drawn. */
const MAP_MARKER_CAP = 100;
const MAP_MAX_AREAS = 5;
const LAST_LISTINGS_SEARCH_KEY = 'draazy.listings.lastSearch.v1';

/* The locality list: filter options, chip labels and the map's fallback focus. */
const loadLocalities = () => listLocalities();
const filterSignature = (value) => JSON.stringify(serializeF(value));
let pendingDrawerBackSnapshot = null;

function readStoredListingsSearch() {
  if (typeof window === 'undefined') return null;
  try {
    const snap = JSON.parse(window.localStorage.getItem(LAST_LISTINGS_SEARCH_KEY));
    return snap && snap.version === 1 ? snap : null;
  } catch {
    return null;
  }
}

function deserializeStoredFilters(filters) {
  try {
    const f = deserializeF(filters);
    return f.deal === 'rent' || f.deal === 'buy' ? f : null;
  } catch {
    return null;
  }
}

function writeStoredListingsSearch(snapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_LISTINGS_SEARCH_KEY, JSON.stringify({ version: 1, ...snapshot, at: Date.now() }));
  } catch {}
}

export default function Listings() {
  const { t: tr } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { toast } = useToast();
  const sendToSignIn = useSignInGate();
  const { create: createSavedSearch } = useSavedSearches();
  const { isIn } = useAuth();
  const { flagEnabled } = useAppFlags();
  const initialHadUrlParams = useRef(params.toString() !== '');
  const [initialListingsSearch] = useState(readStoredListingsSearch);
  const [storedInitialFilters] = useState(() => (!initialHadUrlParams.current ? deserializeStoredFilters(initialListingsSearch?.filters) : null));

  // URL param compat: ?type= / ?ptype= accept one or more canonical type keys
  // (comma-separated) or legacy labels; ?deal=rent|buy is honoured directly.
  const urlTypeRaw = params.get('ptype') || params.get('type') || '';
  const urlTypeKeys = urlTypeRaw.split(',').map(canonicalTypeKey).filter(Boolean);
  // An explicit ?deal= always wins; otherwise a shared-room search opens on Rent.
  const dealParam = params.get('deal');
  const urlDeal = dealParam === 'rent' || dealParam === 'buy'
    ? dealParam
    : ((!initialHadUrlParams.current && storedInitialFilters?.deal) || (urlTypeKeys.includes('flatmates') ? 'rent' : 'buy'));

  // All filters round-trip through the address bar, so a search is shareable, refresh-safe and
  // back-button-safe (see filterState.js).
  const backRestoreInitial = pendingDrawerBackSnapshot;
  const buildInitial = () => backRestoreInitial?.f || storedInitialFilters || paramsToFilters(params, urlDeal);

  const [f, setF] = useState(buildInitial);
  const latestFilterStateRef = useRef(f);
  const [sort, setSort] = useState(() => backRestoreInitial?.sort || (SORTS.includes(params.get('sort')) ? params.get('sort') : (SORTS.includes(initialListingsSearch?.sort) && !initialHadUrlParams.current ? initialListingsSearch.sort : 'relevance')));
  const [page, setPage] = useState(1);
  const [view, setView] = useState(backRestoreInitial?.view || (params.get('view') === 'map' ? 'map' : params.get('view') === 'list' ? 'list' : (!initialHadUrlParams.current && ['map', 'list', 'grid'].includes(initialListingsSearch?.view) ? initialListingsSearch.view : 'grid')));
  const [activeId, setActiveId] = useState(backRestoreInitial?.activeId || params.get('property') || null);
  /* The locality registry, through `useAsyncList` so a failed read has a name and a retry rather than leaving the
     most-visited page in the app on skeletons that never resolve. */
  const [localityRows, localityStatus] = useAsyncList(loadLocalities, []);
  // Only Pune has inventory today, so a data-less live city gets an honest empty state here
  // rather than Pune listings mislabelled as its own.
  const { city } = useCity();
  const hasData = cityHasData(city);
  const [localities, setLocalities] = useState([]);
  const [drawer, setDrawer] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  /* Held in state and mirrored to `?q=` by the same effect that writes the filters, because the
   * address bar tolerates only one writer. */
  const [freeText, setFreeText] = useState(() => backRestoreInitial?.freeText || params.get('q') || (!initialHadUrlParams.current ? initialListingsSearch?.q || '' : ''));
  const stateDrivenDealRef = useRef(null);
  const normalizeFilterPatch = (prev, partial) => {
    if (!Object.prototype.hasOwnProperty.call(partial, 'nearMode')) return partial;
    const nearMode = partial.nearMode;
    if (nearMode !== 'km' && nearMode !== 'min') return partial;
    return { ...partial, nearRadius: clampNearRadius(partial.nearRadius ?? prev.nearRadius, nearMaxFor(nearMode)) };
  };
  const set = (patch) => {
    const resolve = (prev) => normalizeFilterPatch(prev, typeof patch === 'function' ? patch(prev) : patch);
    latestFilterStateRef.current = { ...latestFilterStateRef.current, ...resolve(latestFilterStateRef.current) };
    startTransition(() => setF((prev) => {
      const merged = { ...prev, ...resolve(prev) };
      latestFilterStateRef.current = merged;
      return merged;
    }));
  };
  const clearFreeText = useCallback(() => setFreeText(''), []);
  const clearAll = () => {
    const next = INITIAL(f.deal);
    latestFilterStateRef.current = next;
    setF(next);
    setFreeText('');
  };
  const switchDeal = (deal) => {
    if (deal === f.deal) return;
    stateDrivenDealRef.current = deal;
    startTransition(() => {
      setF((prev) => {
        const next = switchDealFilters(prev, deal);
        latestFilterStateRef.current = next;
        return next;
      });
      setSort('relevance');
      setPage(1);
    });
  };

  useEffect(() => {
    latestFilterStateRef.current = f;
  }, [f]);

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
    if (snap.q != null) setFreeText(snap.q);
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
    if (freeText) sp.set('q', freeText);
    if (activeId) sp.set('property', activeId);
    return '/listings?' + sp.toString();
  };

  // Save the full context (incl. non-URL filters) so the return is lossless even after
  // a refresh on the property page.
  const saveReturnContext = () => setLastSearch({ search: buildReturnSearch(), filters: serializeF(f), q: freeText, view, activeId, scrollY: window.scrollY });

  const onSelectProperty = (id) => setActiveId(id);
  const onCloseProperty = () => setActiveId(null);
  const lastSearchWriteReady = useRef(false);
  const filterTriggerRef = useRef(null);
  const drawerBackRestoreSnapshotRef = useRef(null);
  const markDrawerBackClose = useCallback(() => {
    const snapshot = {
      f: deserializeF(serializeF(latestFilterStateRef.current)),
      freeText,
      view: effView,
      sort,
      activeId,
    };
    drawerBackRestoreSnapshotRef.current = snapshot;
    pendingDrawerBackSnapshot = snapshot;
  }, [activeId, effView, freeText, sort]);

  /* URL; a bare deal change is the toggle, and carries over what both sides can express. */
  // Mirrors the full filter set to the address bar, writing only when the query string actually
  // changes so there is no history churn or render loop.
  useEffect(() => {
    const restoreSnapshot = drawerBackRestoreSnapshotRef.current || pendingDrawerBackSnapshot;
    if (restoreSnapshot) {
      drawerBackRestoreSnapshotRef.current = restoreSnapshot;
      const next = applyFiltersToSearchParams(params, restoreSnapshot.f);
      next.set('deal', restoreSnapshot.f.deal);
      if (restoreSnapshot.view === 'grid') next.delete('view'); else next.set('view', restoreSnapshot.view);
      if (restoreSnapshot.sort === 'relevance') next.delete('sort'); else next.set('sort', restoreSnapshot.sort);
      if (restoreSnapshot.activeId) next.set('property', restoreSnapshot.activeId); else next.delete('property');
      if (restoreSnapshot.freeText) next.set('q', restoreSnapshot.freeText); else next.delete('q');
      const nextSearch = next.toString();
      if (nextSearch !== params.toString()) setParams(next, { replace: true });
      if (
        filterSignature(f) !== filterSignature(restoreSnapshot.f) ||
        freeText !== restoreSnapshot.freeText ||
        view !== restoreSnapshot.view ||
        sort !== restoreSnapshot.sort ||
        activeId !== restoreSnapshot.activeId
      ) {
        latestFilterStateRef.current = restoreSnapshot.f;
        setF(restoreSnapshot.f);
        setFreeText(restoreSnapshot.freeText);
        setView(restoreSnapshot.view);
        setSort(restoreSnapshot.sort);
        setActiveId(restoreSnapshot.activeId);
        return;
      }
      if (nextSearch === params.toString()) {
        drawerBackRestoreSnapshotRef.current = null;
        pendingDrawerBackSnapshot = null;
      }
      return;
    }
    if (f.deal !== urlDeal && stateDrivenDealRef.current !== f.deal) return;
    const next = applyFiltersToSearchParams(params, f);
    next.set('deal', f.deal);
    if (effView === 'grid') next.delete('view'); else next.set('view', effView);
    if (sort === 'relevance') next.delete('sort'); else next.set('sort', sort);
    if (activeId) next.set('property', activeId); else next.delete('property');
    if (freeText) next.set('q', freeText); else next.delete('q');
    const nextSearch = next.toString();
    if (nextSearch !== params.toString()) setParams(next, { replace: true });
    if (stateDrivenDealRef.current === f.deal) stateDrivenDealRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL writes.
  }, [effView, sort, f, activeId, freeText, params, drawer]);

  useEffect(() => {
    if (!lastSearchWriteReady.current) {
      lastSearchWriteReady.current = true;
      return;
    }
    writeStoredListingsSearch({ filters: serializeF(f), q: freeText, view: effView, sort });
  }, [f, freeText, effView, sort]);

  useEffect(() => {
    if (drawerBackRestoreSnapshotRef.current || pendingDrawerBackSnapshot) return;
    setF((prev) => {
      if (prev.deal === urlDeal) return prev;
      return hasFilterParams(params) ? paramsToFilters(params, urlDeal) : switchDealFilters(prev, urlDeal);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a deal.
  }, [urlDeal]);

  useEffect(() => {
    setLocalities((prev) => {
      const seen = new Set(localityRows.map((l) => l.slug));
      return [...localityRows, ...prev.filter((l) => !seen.has(l.slug))];
    });
  }, [localityRows]);

  // A Places pick resolves to a locality that isn't in the option list yet;
  // register it (slug → name) so its chip and the dropdown summary show a friendly name.
  const addLocalityOption = useCallback(({ slug, name, lat, lng }) => {
    if (!slug) return;
    setLocalities((prev) => (prev.some((l) => l.slug === slug) ? prev : [...prev, { slug, name: name || slug, lat: lat ?? null, lng: lng ?? null }]));
  }, []);

  const locNameBySlug = useMemo(() => Object.fromEntries(localities.map((l) => [l.slug, l.name])), [localities]);
  // A shared URL or saved search can carry a slug the list does not hold; ask the server for its name.
  const askedLocalitiesRef = useRef(new Set());
  const locSlugsKey = [...f.localities].sort().join(',');
  useEffect(() => {
    if (localityStatus === 'loading') return;
    locSlugsKey.split(',').filter((slug) => slug && !locNameBySlug[slug] && !askedLocalitiesRef.current.has(slug)).forEach((slug) => {
      askedLocalitiesRef.current.add(slug);
      getLocality(slug).then(addLocalityOption).catch(() => {});
    });
  }, [locSlugsKey, locNameBySlug, localityStatus, addLocalityOption]);
  const suggestedMapLocalities = useMemo(() => {
    const stored = deserializeStoredFilters(initialListingsSearch?.filters);
    if (!stored?.localities?.size) return [];
    const known = new Set(localities.filter((l) => !l.archived).map((l) => l.slug));
    return [...stored.localities].filter((slug) => known.has(slug)).slice(0, MAP_MAX_AREAS);
  }, [initialListingsSearch, localities]);
  const [socNameBySlug, setSocNameBySlug] = useState({});
  const socSlugsKey = [...f.societies].join(',');
  useEffect(() => {
    const missing = socSlugsKey.split(',').filter((slug) => slug && !socNameBySlug[slug]);
    if (!missing.length) return undefined;
    let alive = true;
    missing.forEach((slug) => {
      getSociety(slug)
        .then((s) => { if (alive && s?.name) setSocNameBySlug((prev) => ({ ...prev, [slug]: s.name })); })
        .catch(() => {});
    });
    return () => { alive = false; };
  }, [socSlugsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- names already loaded are not refetched.

  // Deferred filter state — keeps the inputs responsive while the request for the new results is
  // in flight, so a checkbox never waits on the network to look checked.
  const deferredF = useDeferredValue(f);

  // Map view is area-first: plotting a whole city is a heavy read and an unreadable map, so it
  // draws only once 1–MAP_MAX_AREAS localities are chosen, and asks for at most MAP_MARKER_CAP pins.
  const mapAreaCount = f.localities.size;
  const mapGated = effView === 'map' && (mapAreaCount === 0 || mapAreaCount > MAP_MAX_AREAS);
  const size = effView === 'map' ? MAP_MARKER_CAP : PAGE_SIZE;

  const query = useMemo(
    () => (hasData && !mapGated ? toFacetQuery(deferredF, { sort, q: freeText }) : null),
    [hasData, mapGated, deferredF, sort, freeText],
  );
  const relaxedQuery = useMemo(
    () => (query && deferredF.near && deferredF.localities.size
      ? toFacetQuery(deferredF, { sort, q: freeText, dropLocalities: true })
      : null),
    [query, deferredF, sort, freeText],
  );

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
  // A server count: the browser sees one page, so counting badges on it would answer "how many of
  // these 24" while reading as "how many in Baner".
  const verifiedCount = search.data.verifiedTotal;
  /* Area, age, floor and deposit bounds keep listings that never stated the value, because most
   * of the catalogue never states it. */
  const unstatedCount = search.data.unstatedTotal;
  const relaxedNear = search.relaxed
    ? { locNames: [...deferredF.localities].map((s) => locNameBySlug[s] || s), nearLabel: deferredF.nearLabel || tr('listings.thePlace') }
    : null;
  /* "Loaded" is not "not loading": a failed read is settled with nothing to show, and a count
   * for it would be a claim about Pune's inventory rather than about the request. */
  const loaded = search.status === 'ready' || results.length > 0;
  const pageCount = Math.max(1, search.data.pageCount || 1);
  const safePage = Math.min(requestPage, pageCount);

  const ptr = usePullToRefresh(search.refresh);

  // The map fits to its property markers, but a zero-inventory locality has none — the locality
  // centres give it something to focus on rather than the city default.
  const locSig = [...f.localities].sort().join(',');
  const mapFocus = useMemo(() => {
    if (!f.localities.size) return [];
    return localities
      .filter((l) => f.localities.has(l.slug) && l.lat != null && l.lng != null)
      .map((l) => [l.lat, l.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `locSig` is.
  }, [locSig, localities]);

  // The server already returned exactly one page, so there is nothing left to slice. `mapGated`
  // suspends the request rather than fetching a batch the map has decided not to draw.
  const pageResults = mapGated ? [] : results;
  const activeIndex = activeId ? pageResults.findIndex((p) => p.id === activeId) : -1;
  const activeProperty = activeIndex >= 0 ? pageResults[activeIndex] : null;
  const goToPage = (n) => {
    setPage(Math.min(Math.max(1, n), pageCount));
    /* No explicit `behavior`: it defaults to `auto`, which the spec defines as deferring to the computed
       `scroll-behavior` — so both the media query and the app's own "Reduce motion" toggle are already honoured. */
    window.scrollTo({ top: 0 });
  };

  const intentLogged = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const loc = deferredF.localities.size === 1 ? [...deferredF.localities][0] : '';
    const bhk = deferredF.bhk.size === 1 ? [...deferredF.bhk][0] : '';
    const key = `${loc}|${deferredF.deal}|${bhk}`;
    if (key === intentLogged.current || (!loc && !bhk)) return;
    intentLogged.current = key;
    recordSignal({ kind: 'search', localitySlug: loc, deal: deferredF.deal, bhk });
  }, [deferredF, loaded]);

  const activeChips = useMemo(
    () => buildActiveChips(f, { tr, locNameBySlug, socNameBySlug, setF, set, freeText, clearFreeText }),
    [f, locNameBySlug, socNameBySlug, tr, freeText, clearFreeText],
  );

  const applyParsed = (parsed) => {
    if (parsed.next.deal !== f.deal) stateDrivenDealRef.current = parsed.next.deal;
    setF(parsed.next);
    setFreeText(parsed.q);
  };

  const smartSearch = () => {
    const parsed = parseSmartQuery(aiQuery, { current: f, localities, locNameBySlug });
    if (!parsed) return;
    applyParsed(parsed);
    const detail = [...parsed.parts, parsed.q && tr('listings.smartFreeText', { text: parsed.q })]
      .filter(Boolean).join(' · ');
    toast(tr('listings.smartSearchToast', { detail }), 'success');
  };

  const saveSearch = async () => {
    // Alerts are keyed by mobile and live in the login-only dashboard, so a search saved while
    // signed out would be orphaned under 'anon' and never surface there.
    if (!isIn) {
      sendToSignIn('alerts');
      return;
    }
    if (savingSearch) return;
    setSavingSearch(true);
    // If the box has a typed query, parse it so the saved criteria match the label/text
    // (and apply it to the results) — no more "label says X but filters say Y" mismatch.
    try {
      const typed = aiQuery.trim();
      const parsed = typed ? parseSmartQuery(aiQuery, { current: f, localities, locNameBySlug }) : null;
      if (parsed) applyParsed(parsed);
      const record = buildAlertRecord(parsed ? parsed.next : f, locNameBySlug);
      await createSavedSearch({ ...record, label: typed || record.label, query: typed });
      toast(tr('listings.searchSavedToast'), 'success');
    } catch {
      toast(tr('listings.searchSaveFailedToast'), 'error');
    } finally {
      setSavingSearch(false);
    }
  };
  return (
    <>
      <MobileFilterDrawer drawer={drawer} setDrawer={setDrawer} f={f} set={set} localities={localities} onAddLocality={addLocalityOption} clearAll={clearAll} total={total} triggerRef={filterTriggerRef} onBackClose={markDrawerBackClose} />

      {/* This route is selfPadded, so the top offset derives from the navbar token plus a breathing gap rather than
         restating the bar's height. */}
      <div ref={ptr.ref} className="pt-[calc(var(--dz-nav-h)+8px)] sm:pt-[calc(var(--dz-nav-h)+20px)] pb-20">
        {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
          <div
            aria-hidden="true"
            className="glass-strong pointer-events-none fixed left-1/2 z-40 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
            style={{ top: `calc(var(--dz-nav-h) + ${Math.round(ptr.pullDistance)}px)`, opacity: 0.4 + ptr.progress * 0.6 }}
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

          <div className="flex flex-row items-center justify-between gap-2.5 sm:gap-3 mb-3.5 sm:mb-5 list-reveal" style={{ animationDelay: '60ms' }}>
            <h1 className="min-w-0 text-3xl font-bold text-white leading-tight">
              <span className="sm:hidden">{f.deal === 'rent' ? tr('listings.titleShortForRent', { city }) : tr('listings.titleShortForSale', { city })}</span>
              <span className="hidden sm:inline">{f.deal === 'rent' ? tr('listings.titleForRent', { city }) : tr('listings.titleForSale', { city })}</span>
            </h1>
            {hasData ? <DealToggle deal={f.deal} onChange={switchDeal} className="shrink-0 lg:hidden" /> : null}
          </div>

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

            <ResultsArea f={f} set={set} localities={localities} aiQuery={aiQuery} setAiQuery={setAiQuery} smartSearch={smartSearch} saveSearch={saveSearch} savingSearch={savingSearch} results={pageResults} total={total} verifiedCount={verifiedCount} unstatedCount={unstatedCount} relaxedNear={relaxedNear} page={safePage} pageCount={pageCount} goToPage={goToPage} view={effView} setView={setView} sort={sort} setSort={setSort} flagEnabled={flagEnabled} activeChips={activeChips} clearAll={clearAll} locNameBySlug={locNameBySlug} loaded={loaded} loadFailed={search.status === 'error'} searching={search.status === 'loading'} loadError={search.error} onRetryLoad={search.retry} toast={toast} onOpenFilters={() => setDrawer(true)} filterTriggerRef={filterTriggerRef} mapGated={mapGated} mapAreaCount={mapAreaCount} mapMaxAreas={MAP_MAX_AREAS} mapMarkerCap={MAP_MARKER_CAP} mapFocus={mapFocus} activeId={activeId} activeProperty={activeProperty} activeIndex={activeIndex} onSelectProperty={onSelectProperty} onCloseProperty={onCloseProperty} fromSearch={buildReturnSearch()} onOpenProperty={saveReturnContext} isIn={isIn} mapUnavailable={view === 'map' && !mapEnabled} suggestedMapLocalities={suggestedMapLocalities} />
          </div>
          )}
        </div>
      </div>
    </>
  );
}
