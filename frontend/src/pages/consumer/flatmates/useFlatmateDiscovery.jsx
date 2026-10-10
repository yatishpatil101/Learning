import { useMemo, useState, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useLocalityCoords } from './useLocalityCoords.js';
import { TAB_MOVE_IN, TAB_TEAM_UP, normalizeTab, decorateRooms } from './model.js';
import { inr, withCoords, BUDGET_MIN, BUDGET_MAX, budgetIsAny, segClass } from './helpers.js';
import {
  applyFlatmateStateToSearchParams,
  clearRememberedFlatmateSearch,
  flatmateFiltersEqual,
  flatmateFiltersFromParams,
  hasFlatmateSearchParams,
  readRememberedFlatmateSearch,
  saveRememberedFlatmateSearch,
  sortFromParams,
} from '../../../lib/flatmates/filterState.js';
import toFlatmateQuery from './facetQuery.js';
import useFlatmatesSearch from './useFlatmatesSearch.js';
import useRaiseHint from './useRaiseHint.js';

export const emptyFilters = { q: '', locality: '', budget: [BUDGET_MIN, BUDGET_MAX], moveIn: '', gender: '', sharing: '', verifiedOnly: false, attachedBath: false, habits: [], near: '', nearLabel: '', nearRadius: 5, nearMode: 'km' };
// Only `near` itself counts as an active filter, so a leftover radius cannot inflate the badge
// after the place is cleared.
const NEAR_TUNING_KEYS = ['nearLabel', 'nearRadius', 'nearMode'];

const LIST_PAGE = 24;
/* The map draws one pin per area with a count on it, so a screenful would claim "Baner 3" for
 * an area holding ninety. 100 is the server's page cap. */
const MAP_PAGE = 100;
const URL_REPLACE_KEYS = new Set(['q', 'budget', 'nearRadius']);

const isoInDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Takes no row collections: the server filters, ranks, counts and pages the board. A client-side pass over a fetched
// slice would make every filter, the ranking and the counts mean "of the first N".
export function useFlatmateDiscovery({ tab, setTab, viewMode, t, toast, myPost, openPostModal, onPost }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const localityCoords = useLocalityCoords();
  const initFromUrl = () => (hasFlatmateSearchParams(params)
    ? flatmateFiltersFromParams(params, emptyFilters)
    : readRememberedFlatmateSearch(emptyFilters) || { ...emptyFilters, budget: [...emptyFilters.budget], habits: [] });
  // Map view only — never touches the list, the URL or the posting model. Empty => focus gate.
  const [mapAreas, setMapAreas] = useState(() => new Set());
  const [filters, setFilters] = useState(initFromUrl);
  const [sortMode, setSortMode] = useState(() => sortFromParams(params));
  const paramsRef = useRef(params);
  const filtersRef = useRef(filters);
  const sortRef = useRef(sortMode);
  const tabRef = useRef(tab);
  const urlWriteModeRef = useRef('replace');
  const lastWrittenRef = useRef('');
  const onSort = (s) => {
    if (s === 'match' && !myPost) { toast(t('flatmates.toastPostToRank')); openPostModal(); return; }
    urlWriteModeRef.current = 'push';
    setSortMode(s);
  };

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { sortRef.current = sortMode; }, [sortMode]);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const setF = (patch) => {
    const keys = Object.keys(patch);
    urlWriteModeRef.current = keys.length > 0 && keys.every((key) => URL_REPLACE_KEYS.has(key)) ? 'replace' : 'push';
    setFilters((p) => ({ ...p, ...patch }));
  };
  // Switching tabs clears the filter the destination cannot honour, so a stale value never lingers
  // as an invisible, uncountable active filter after its control is hidden.
  const selectTab = (next) => {
    urlWriteModeRef.current = 'push';
    setTab(next);
    setMapAreas(new Set());
    setFilters((f) => ({
      ...f,
      sharing: next === TAB_TEAM_UP ? f.sharing : '',
      attachedBath: next === TAB_MOVE_IN ? f.attachedBath : false,
    }));
  };

  const activeFilterCount = useMemo(() => Object.keys(emptyFilters).filter((k) => {
    if (k === 'q' || NEAR_TUNING_KEYS.includes(k)) return false;
    // `budget` is a tuple, so it needs the bounds test: the `Array.isArray` rule below is right for
    // `habits` but permanently true of a range, and the badge would never read zero.
    if (k === 'budget') return !budgetIsAny(filters.budget);
    const def = emptyFilters[k];
    return Array.isArray(def) ? filters[k].length > 0 : filters[k] !== def;
  }).length, [filters]);

  // `q` counts here, unlike `activeFilterCount`, because a typed query is still something
  // "Clear filters" must be able to undo.
  const filtersActive = useMemo(() => activeFilterCount > 0 || filters.q !== '', [activeFilterCount, filters.q]);
  // Spread, including the nested arrays: handing the shared module constant out as state would let
  // one future `filters.habits.push(...)` corrupt the app-wide default permanently.
  const clearFilters = () => {
    urlWriteModeRef.current = 'replace';
    clearRememberedFlatmateSearch();
    lastWrittenRef.current = '';
    setFilters({ ...emptyFilters, budget: [...emptyFilters.budget], habits: [] });
    setMapAreas(new Set());
  };

  const reconcileFromUrl = (source) => {
    lastWrittenRef.current = '';
    const nextFilters = hasFlatmateSearchParams(source)
      ? flatmateFiltersFromParams(source, emptyFilters)
      : readRememberedFlatmateSearch(emptyFilters) || { ...emptyFilters, budget: [...emptyFilters.budget], habits: [] };
    setFilters((current) => (flatmateFiltersEqual(current, nextFilters) ? current : nextFilters));

    const nextSort = sortFromParams(source);
    if (sortRef.current !== nextSort) setSortMode(nextSort);

    const nextTab = normalizeTab(source.get('view'));
    if (tabRef.current !== nextTab) {
      setTab(nextTab);
      setMapAreas(new Set());
    }
  };

  useEffect(() => {
    reconcileFromUrl(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL params are.
  }, [params, setTab]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname === pathname) reconcileFromUrl(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the popstate.
  }, [pathname, setTab]);

  useEffect(() => {
    saveRememberedFlatmateSearch(filters, emptyFilters);
    const mode = urlWriteModeRef.current;
    const timer = window.setTimeout(() => {
      if (window.location.pathname !== pathname) return;
      const next = applyFlatmateStateToSearchParams(paramsRef.current, filters, emptyFilters, { sort: sortMode, tab });
      const nextString = next.toString();
      if (nextString !== paramsRef.current.toString()) {
        lastWrittenRef.current = nextString;
        setParams(next, { replace: mode !== 'push' });
      }
      if (urlWriteModeRef.current === mode) urlWriteModeRef.current = 'replace';
    }, mode === 'push' ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [filters, sortMode, tab, setParams, pathname]);

  /* Nothing below filters or re-sorts the result: two predicates over the same field intersect to the narrower one,
     so a client-side copy silently discards what the server just learned. */
  const query = useMemo(
    () => toFlatmateQuery(filters, { sort: sortMode, myPost }),
    [filters, sortMode, myPost],
  );

  const size = viewMode === 'map' ? MAP_PAGE : LIST_PAGE;
  const [page, setPage] = useState(0);
  const requestKey = useMemo(() => JSON.stringify([query, tab, size]), [query, tab, size]);
  const [pagedKey, setPagedKey] = useState(requestKey);
  if (pagedKey !== requestKey) {
    setPagedKey(requestKey);
    if (page !== 0) setPage(0);
  }
  const requestPage = pagedKey === requestKey ? page : 0;

  const search = useFlatmatesSearch({ tab, filters: query, page: requestPage, size });

  const activeList = useMemo(() => {
    const withPoints = search.items.map((p) => withCoords(p, localityCoords));
    const roomsOnPage = decorateRooms(withPoints.filter((x) => x.kind === 'room'));
    const byId = new Map(roomsOnPage.map((r) => [r.id, r]));
    return withPoints.map((x) => byId.get(x.id) || x);
  }, [search.items, localityCoords]);

  const total = search.total;
  const verifiedTotal = search.verifiedTotal;
  const pageCount = search.pageCount;
  /* A response can shrink the set under a cursor already past its end; without the clamp the
   * pager would highlight, for one paint, a page number it has stopped showing. */
  const safePage = Math.min(requestPage, Math.max(0, pageCount - 1));
  /* One page change, one scroll: a pager sits under a screenful, so clicking "2" without this
   * leaves the viewport at the tail of a list whose head the user never saw. */
  const goToPage = (n) => {
    setPage(Math.min(Math.max(0, n), Math.max(0, pageCount - 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // `null` until the server has answered once, so a tab badge can say "not known yet" rather than
  // asserting zero. See `tabCount` below.
  const loadedTotal = search.loaded ? total : null;
  // Cross-tab rescue: when this feed is empty the other may still hold stock for the same filters.
  // Counted by the server over the whole match, not by the browser over rows already fetched.
  const otherTab = tab === TAB_MOVE_IN ? TAB_TEAM_UP : TAB_MOVE_IN;
  const otherCount = search.otherCount ?? 0;
  const switchTab = () => selectTab(otherTab);

  // When a tab returns nothing and budget is the binding constraint, ask what the cheapest
  // otherwise-matching row costs so the empty state has a real next step.
  const raiseHint = useRaiseHint({ tab, filters, query, empty: total === 0 && search.status === 'ready' });

  const byLocality = useMemo(() => {
    const m = {};
    const add = (loc, item) => { if (localityCoords[loc]) (m[loc] = m[loc] || []).push(item); };
    activeList.forEach((it) => {
      const locs = (it.localities && it.localities.length) ? it.localities : (it.locality ? [it.locality] : []);
      locs.forEach((l) => add(l, it));
    });
    return m;
  }, [activeList, localityCoords]);
  const kindWord = tab === TAB_MOVE_IN ? 'homes' : 'flatmates';

  // Only areas that hold matching posts, ranked by count, so a pick never dead-ends.
  const gateAreas = useMemo(
    () => Object.entries(byLocality).map(([name, arr]) => ({ name, count: arr.length })).sort((a, b) => b.count - a.count),
    [byLocality],
  );
  // A proximity search already narrows posts to the point's radius, so the map can
  // show every matching area. Otherwise the map is limited to the focused areas.
  const mapItems = useMemo(() => {
    if (filters.near) return byLocality;
    if (!mapAreas.size) return {};
    return Object.fromEntries(Object.entries(byLocality).filter(([name]) => mapAreas.has(name)));
  }, [byLocality, mapAreas, filters.near]);
  const mapGated = viewMode === 'map' && mapAreas.size === 0 && !filters.near;
  const toggleMapArea = (name) => setMapAreas((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  // Carries a single active locality filter into the map focus on entry, so a user who already
  // narrowed to one area is not asked to re-pick it.
  useEffect(() => {
    if (viewMode === 'map' && filters.locality && mapAreas.size === 0 && !filters.near) {
      setMapAreas(new Set([filters.locality]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entering map.
  }, [viewMode]);

  const budgetLbl = budgetIsAny(filters.budget)
    ? t('flatmates.any')
    : filters.budget[0] <= BUDGET_MIN
      ? '≤ ' + inr(filters.budget[1])
      : filters.budget[1] >= BUDGET_MAX
        ? '≥ ' + inr(filters.budget[0])
        : inr(filters.budget[0]) + ' – ' + inr(filters.budget[1]);

  const seg = segClass;
  // Once a sentence is translated into structured chips the raw sentence must be CLEARED from `q`,
  // or it keeps applying as a substring match and silently zeroes out honest results.
  const smartSearchFlat = (raw = filters.q) => {
    const rawQuery = String(raw);
    const q = rawQuery.toLowerCase().trim();
    if (!q) return false;
    urlWriteModeRef.current = 'push';
    const next = { ...emptyFilters, budget: [...emptyFilters.budget], habits: [], q: rawQuery };
    const parts = [];

    if (/\b(girl|woman|women|female)\b/.test(q)) { next.gender = 'female'; parts.push(t('flatmates.gWomen')); }
    else if (/\b(boy|man|men|male|guy)\b/.test(q)) { next.gender = 'male'; parts.push(t('flatmates.gMen')); }

    // A sentence only ever states a CEILING ("under 12000", "15k"), so the floor stays at
    // BUDGET_MIN — inferring a minimum would hide the cheap rooms the seeker most wants.
    const budgetM = q.match(/(\d+)\s*k/);
    if (budgetM) next.budget = [BUDGET_MIN, parseInt(budgetM[1], 10) * 1000];
    const budgetD = q.match(/under\s*(\d{4,})/);
    if (budgetD) next.budget = [BUDGET_MIN, parseInt(budgetD[1], 10)];
    if (!budgetIsAny(next.budget)) parts.push('≤ ' + inr(next.budget[1]));

    const loc = Object.keys(localityCoords).find((l) => q.includes(l.toLowerCase()));
    if (loc) { next.locality = loc; parts.push(loc); }

    if (/\b(immediate|now|asap|urgent)\b/.test(q)) { next.moveIn = 'now'; parts.push(t('flatmates.immediate')); }
    else if (/\b(15\s*day|2\s*week)\b/.test(q)) { next.moveIn = isoInDays(15); parts.push(t('flatmates.partWithin15Days')); }
    else if (/\b(month|30\s*day)\b/.test(q)) { next.moveIn = isoInDays(30); parts.push(t('flatmates.partWithinMonth')); }

    if (/\b(verified|trusted)\b/.test(q)) { next.verifiedOnly = true; parts.push(t('flatmates.verifiedOnly')); }

    if (/\battach(ed)?\b.*\b(bath|washroom|toilet)|private\s*(bath|washroom|toilet)/.test(q)) { next.attachedBath = true; parts.push(t('flatmates.attachedBath')); }

    const habits = [];
    if (/non[-\s]?smok|no\s*smoking|smoke[-\s]?free/.test(q)) habits.push('Non-smoker');
    if (/\bvegetarian\b/.test(q) || (/\bveg\b/.test(q) && !/non[-\s]?veg/.test(q))) habits.push('Vegetarian');
    if (/\bpet(s|[-\s]?friendly)?\b/.test(q)) habits.push('Pet-friendly');
    if (habits.length) { next.habits = habits; parts.push(...habits); }

    // If at least one structured filter was understood, drop the raw sentence so it stops fighting
    // the chips. If nothing parsed, keep it as a plain text search.
    const parsed = parts.length > 0;
    if (parsed) next.q = '';

    filtersRef.current = next;
    setFilters(next);
    toast(parsed ? t('flatmates.smartSearchToast', { detail: parts.join(' · ') }) : t('flatmates.searchingQuery', { query: rawQuery.trim() }), 'success');
    return parsed;
  };

  const tabCls = (on) =>
    'seg flex-1 sm:flex-none min-w-0 justify-center sm:justify-start text-[13px] sm:text-sm font-semibold px-2.5 sm:px-4 py-2.5 min-h-11 rounded-xl text-gray-300 flex items-center gap-1.5 sm:gap-2'
    + (on ? ' active' : '');
  /* Counts are rendered: stock a seeker cannot see is stock they never switch tabs for. */
  const tabCount = (n) => (
    <span className={'ml-0.5 shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ' + (n ? 'bg-white/10 text-gray-100' : 'bg-white/5 text-gray-500')}>{n == null ? '·' : n}</span>
  );
  const moveInCount = tab === TAB_MOVE_IN ? loadedTotal : search.otherCount;
  const teamUpCount = tab === TAB_TEAM_UP ? loadedTotal : search.otherCount;
  /* `aria-label` REPLACES the content, so it cannot say "0" where the badge deliberately says
   * "·". */
  const tabLabel = (countedKey, plainKey, n) => (n == null ? t(plainKey) : t(countedKey, { count: n }));
  const flatmateTabs = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex items-center gap-2">
        <button onClick={() => selectTab(TAB_MOVE_IN)} aria-current={tab === TAB_MOVE_IN ? 'page' : undefined} aria-label={tabLabel('flatmates.ariaMoveInCount', 'flatmates.ariaMoveIn', moveInCount)} className={tabCls(tab === TAB_MOVE_IN)}>
          <Icon name="door-open" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.tabMoveIn')}</span>{tabCount(moveInCount)}
        </button>
        <button onClick={() => selectTab(TAB_TEAM_UP)} aria-current={tab === TAB_TEAM_UP ? 'page' : undefined} aria-label={tabLabel('flatmates.ariaTeamUpCount', 'flatmates.ariaTeamUp', teamUpCount)} className={tabCls(tab === TAB_TEAM_UP)}>
          <Icon name="users-round" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.tabTeamUp')}</span>{tabCount(teamUpCount)}
        </button>
      </div>
      <div className="hidden sm:block flex-1" />

      {/* The rule lives in routes/flatmates.css because buttons.css loads later and would win the specificity tie. */}
      <button onClick={onPost} className="sf-post-cta btn-teal h-10 inline-flex items-center justify-center gap-2 px-4 rounded-full text-white text-sm font-semibold w-full sm:w-auto shrink-0">
        <Icon name="plus" className="w-4 h-4" /> {t('flatmates.postCta')}
      </button>
    </div>
  );

  return {
    filters, setFilters, setF, sortMode, onSort,
    mapAreas, setMapAreas, toggleMapArea, mapGated, mapItems,
    filtersActive, clearFilters, activeFilterCount,
    activeList,
    // `total` is the whole match, not `activeList.length` — reading a count off a page is the bug
    // this endpoint shape exists to prevent.
    total, verifiedTotal, pageCount, page: safePage, goToPage,
    /* "There is a real answer on screen", which is not the negation of `loading`: without it the first paint of a
       cold board asserts "0 homes available" about an unanswered search. */
    loaded: search.loaded || activeList.length > 0,
    searching: search.status === 'loading',
    searchStatus: search.status, searchError: search.error, retrySearch: search.retry,
    refreshSearch: search.refresh,
    otherTab, otherCount, switchTab, byLocality, gateAreas,
    kindWord, seg, budgetLbl, raiseHint, smartSearchFlat, flatmateTabs,
  };
}
