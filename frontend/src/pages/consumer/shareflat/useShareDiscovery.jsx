import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { LOCALITIES, LOCALITY_COORDS } from './constants.js';
import { inr, perHead, sortPosts, seekerMatches, roomMatches, groupMatches, withCoords } from './helpers.js';

export const emptyFilters = { q: '', locality: '', budget: 40000, moveIn: '', gender: '', sharing: '', verifiedOnly: false, attachedBath: false, habits: [], near: '', nearLabel: '', nearRadius: 5, nearMode: 'km' };
// Filter keys that describe the "Near a Place" tuning (radius/mode/label) rather
// than a distinct active filter — only `near` itself counts as an active filter,
// so a leftover radius can't inflate the active-filter badge after the place is
// cleared.
const NEAR_TUNING_KEYS = ['nearLabel', 'nearRadius', 'nearMode'];

// Local-time ISO (yyyy-mm-dd) N days from today — used by smart-search to turn a
// fuzzy "within 15 days" phrase into the same concrete date the picker produces.
const isoInDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Discovery: filters/sort/map UI state plus every derived list and filter helper.
// Shared data (requests/rooms/groups) and cross-domain handlers arrive as params
// so this hook stays a pure read-side view over the orchestrator's state.
export function useShareDiscovery({ tab, setTab, viewMode, requests, rooms, groups, t, toast, myPost, reviewMap, openPostModal, listRoom, createGroup }) {
  const [params] = useSearchParams();
  // Carry selections from the home flatmate search / listings rent CTA:
  //   ?view=<flatmates|rooms|groups>&loc=<locality name>&g=<male|female>
  const initFromUrl = () => {
    const f = { ...emptyFilters };
    const loc = (params.get('loc') || '').trim();
    if (loc) {
      const hit = LOCALITIES.find((l) => l.toLowerCase() === loc.toLowerCase());
      if (hit) f.locality = hit; // only apply localities this page actually offers
    }
    const g = params.get('g');
    if (g === 'male' || g === 'female') f.gender = g;
    // Deep-link a proximity search (shared "Near a Place" URL contract, same keys
    // Listings uses): ?near=lat,lng&nearlabel=&nearr=&nearmode=km|min
    const near = (params.get('near') || '').trim();
    if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) {
      f.near = near;
      f.nearLabel = params.get('nearlabel') || 'Selected place';
      const r = Number(params.get('nearr'));
      if (!Number.isNaN(r) && r > 0) f.nearRadius = r;
      const mode = params.get('nearmode');
      if (mode === 'min' || mode === 'km') f.nearMode = mode;
    }
    return f;
  };
  // Localities the map is focused on (map view only — never touches the list, the
  // URL or the posting model). Empty => the map shows the focus gate instead.
  const [mapAreas, setMapAreas] = useState(() => new Set());
  const [filters, setFilters] = useState(initFromUrl);
  const [sortMode, setSortMode] = useState('verified');
  const onSort = (s) => { if (s === 'match' && !myPost) { toast(t('shareFlat.toastPostToRank')); openPostModal(); return; } setSortMode(s); };

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  // Switching tabs clears the filter that the destination tab can't honour, so a
  // stale "Sharing" (groups-only) or "Move-in" (flatmates/rooms-only) value never
  // lingers as an invisible, uncountable active filter after the control is hidden.
  const selectTab = (t) => {
    setTab(t);
    setMapAreas(new Set());
    setFilters((f) => ({ ...f, moveIn: t === 'groups' ? '' : f.moveIn, sharing: t === 'groups' ? f.sharing : '' }));
  };

  // Whether any filter narrows the default view — drives the "Clear filters" CTA
  // in empty states.
  const filtersActive = useMemo(() => (
    filters.q !== '' || filters.locality !== '' || filters.budget < 40000
    || filters.moveIn !== '' || filters.gender !== '' || filters.sharing !== '' || filters.verifiedOnly
    || filters.attachedBath || filters.near !== ''
    || filters.habits.length > 0
  ), [filters]);
  const clearFilters = () => { setFilters(emptyFilters); setMapAreas(new Set()); };

  // Count of active narrowing filters (the free-text query doesn't count). Once a
  // seeker narrows with 2+ filters they've shown enough intent to be offered an
  // alert, so the "create an alert" card appears — mirroring the listings page,
  // which surfaces its alert card as the search tightens.
  const activeFilterCount = useMemo(() => Object.keys(emptyFilters).filter((k) => {
    if (k === 'q' || NEAR_TUNING_KEYS.includes(k)) return false;
    const def = emptyFilters[k];
    return Array.isArray(def) ? filters[k].length > 0 : filters[k] !== def;
  }).length, [filters]);

  // Standardise every post with per-post coordinates before it's filtered/mapped.
  // A room geocoded via the list-property flow keeps its real point; seeds and
  // locality-only posts get a stable centroid-derived point. This one funnel gives
  // cards, the map and the "Near a Place" radius filter a uniform listing-like shape
  // and backfills old localStorage posts with no migration write.
  const requestsC = useMemo(() => requests.map(withCoords), [requests]);
  const roomsC = useMemo(() => rooms.map(withCoords), [rooms]);
  const groupsC = useMemo(() => groups.map(withCoords), [groups]);

  const seekerList = useMemo(
    () => sortPosts(requestsC.filter((r) => !(myPost && r.id === myPost.id) && seekerMatches(r, filters)), sortMode, myPost),
    [requestsC, filters, myPost, sortMode],
  );
  const roomList = useMemo(
    () => sortPosts(roomsC.filter((r) => roomMatches(r, filters, reviewMap[r.id])), sortMode, myPost),
    [roomsC, filters, sortMode, myPost, reviewMap],
  );
  const groupList = useMemo(
    () => sortPosts(groupsC.filter((g) => groupMatches(g, filters, reviewMap[g.id])), sortMode, myPost),
    [groupsC, filters, sortMode, myPost, reviewMap],
  );

  // Empty-state intelligence: when a tab returns nothing AND budget is the binding
  // constraint, find the cheapest post that would match if budget were "Any" so the
  // empty state can say "the cheapest match is ₹X — raise your budget" instead of a
  // dead end. Only runs when the active list is empty (cheap, and the common case).
  const raiseHint = useMemo(() => {
    if (filters.budget >= 40000) return null;
    const any = { ...filters, budget: 40000 };
    let pool, priceOf;
    if (tab === 'groups') {
      if (groupList.length) return null;
      pool = groupsC.filter((g) => groupMatches(g, any, reviewMap[g.id]));
      priceOf = (g) => perHead(g);
    } else if (tab === 'rooms') {
      if (roomList.length) return null;
      pool = roomsC.filter((r) => roomMatches(r, any, reviewMap[r.id]));
      priceOf = (r) => r.budget;
    } else {
      if (seekerList.length) return null;
      pool = requestsC.filter((r) => !(myPost && r.id === myPost.id) && seekerMatches(r, any));
      priceOf = (r) => r.budget;
    }
    if (!pool.length) return null;
    const min = Math.min(...pool.map(priceOf));
    if (!(min > filters.budget)) return null; // budget wasn't the blocker
    return { price: min, budget: Math.min(40000, Math.ceil(min / 1000) * 1000) };
  }, [tab, filters, seekerList, roomList, groupList, requestsC, roomsC, groupsC, reviewMap, myPost]);

  const byLocality = useMemo(() => {
    const m = {};
    const add = (loc, item) => { if (LOCALITY_COORDS[loc]) (m[loc] = m[loc] || []).push(item); };
    if (tab === 'groups') groupList.forEach((g) => add(g.locality, g));
    else if (tab === 'rooms') roomList.forEach((r) => r.localities.forEach((l) => add(l, r)));
    else seekerList.forEach((r) => r.localities.forEach((l) => add(l, r)));
    return m;
  }, [tab, seekerList, roomList, groupList]);
  const kindWord = tab === 'groups' ? 'groups' : tab === 'rooms' ? 'rooms' : 'flatmates';

  // Localities that actually hold matching posts, ranked by count — the chips the
  // map focus gate offers (only areas with stock, so a pick never dead-ends).
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
  // Carry a single active locality filter into the map focus on entry, so a user
  // who already narrowed to one area isn't asked to re-pick it.
  useEffect(() => {
    if (viewMode === 'map' && filters.locality && mapAreas.size === 0 && !filters.near) {
      setMapAreas(new Set([filters.locality]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const budgetLbl = filters.budget >= 40000 ? t('shareFlat.any') : '≤ ' + inr(filters.budget);

  /* ─── Unified sizing scale for this page ───
     control: h-9 (36px) — all filter pills, dropdowns, toggles, sort buttons
     tab:     h-10 (40px) — primary navigation tabs
     cta:     h-11 (44px) — primary action buttons (Post, Create group)
     All controls use text-sm (14px) and rounded-xl (12px) for consistency. */
  const seg = (active) => 'seg text-sm font-semibold px-4 h-10 inline-flex items-center rounded-full text-gray-300 box-border' + (active ? ' active' : '');
  // Smart search: parse natural language queries into filter values. The search
  // box doubles as a live literal text filter, so once we've translated a sentence
  // into structured chips we must CLEAR the raw sentence from `q` — otherwise it
  // keeps applying as a substring match and silently zeroes out honest results.
  const smartSearchFlat = () => {
    const q = filters.q.toLowerCase().trim();
    if (!q) return;
    const next = { ...emptyFilters, q: filters.q };
    const parts = [];

    // Gender detection
    if (/\b(girl|woman|women|female)\b/.test(q)) { next.gender = 'female'; parts.push(t('shareFlat.gWomen')); }
    else if (/\b(boy|man|men|male|guy)\b/.test(q)) { next.gender = 'male'; parts.push(t('shareFlat.gMen')); }

    // Budget detection
    const budgetM = q.match(/(\d+)\s*k/);
    if (budgetM) next.budget = parseInt(budgetM[1], 10) * 1000;
    const budgetD = q.match(/under\s*(\d{4,})/);
    if (budgetD) next.budget = parseInt(budgetD[1], 10);
    if (next.budget !== emptyFilters.budget) parts.push('≤ ' + inr(next.budget));

    // Locality detection
    const loc = LOCALITIES.find((l) => q.includes(l.toLowerCase()));
    if (loc) { next.locality = loc; parts.push(loc); }

    // Move-in detection → immediate, or a concrete target date the picker shows
    if (/\b(immediate|now|asap|urgent)\b/.test(q)) { next.moveIn = 'now'; parts.push(t('shareFlat.immediate')); }
    else if (/\b(15\s*day|2\s*week)\b/.test(q)) { next.moveIn = isoInDays(15); parts.push(t('shareFlat.partWithin15Days')); }
    else if (/\b(month|30\s*day)\b/.test(q)) { next.moveIn = isoInDays(30); parts.push(t('shareFlat.partWithinMonth')); }

    // Verified detection
    if (/\b(verified|trusted)\b/.test(q)) { next.verifiedOnly = true; parts.push(t('shareFlat.verifiedOnly')); }

    // Attached washroom detection (rooms) — a top seeker dealbreaker.
    if (/\battach(ed)?\b.*\b(bath|washroom|toilet)|private\s*(bath|washroom|toilet)/.test(q)) { next.attachedBath = true; parts.push(t('shareFlat.attachedBath')); }

    // Lifestyle / habit detection (flatmate dealbreakers)
    const habits = [];
    if (/non[-\s]?smok|no\s*smoking|smoke[-\s]?free/.test(q)) habits.push('Non-smoker');
    if (/\bvegetarian\b/.test(q) || (/\bveg\b/.test(q) && !/non[-\s]?veg/.test(q))) habits.push('Vegetarian');
    if (/\bpet(s|[-\s]?friendly)?\b/.test(q)) habits.push('Pet-friendly');
    if (habits.length) { next.habits = habits; parts.push(...habits); }

    // If we understood at least one structured filter, drop the raw sentence so it
    // stops fighting the chips. If nothing parsed, keep it as a plain text search.
    if (parts.length) next.q = '';

    setFilters(next);
    toast(parts.length ? t('shareFlat.smartSearchToast', { detail: parts.join(' · ') }) : t('shareFlat.searchingQuery', { query: filters.q.trim() }), 'success');
  };

  const shareTabs = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <HScroll className="flex items-center gap-2 sm:overflow-visible" fadeColor="rgb(27,25,37)" fadeWidth="1.25rem">
        <button onClick={() => selectTab('flatmates')} aria-current={tab === 'flatmates' ? 'page' : undefined} aria-label={t('shareFlat.ariaFlatmatesCount', { count: seekerList.length })} className={'seg shrink-0 text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-300 flex items-center gap-2' + (tab === 'flatmates' ? ' active' : '')}><Icon name="user-search" className="w-4 h-4" /> {t('shareFlat.tabFlatmates')}</button>
        <button onClick={() => selectTab('rooms')} aria-current={tab === 'rooms' ? 'page' : undefined} aria-label={t('shareFlat.ariaRoomsCount', { count: roomList.length })} className={'seg shrink-0 text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-300 flex items-center gap-2' + (tab === 'rooms' ? ' active' : '')}><Icon name="door-open" className="w-4 h-4" /> {t('shareFlat.tabRooms')}</button>
        <button onClick={() => selectTab('groups')} aria-current={tab === 'groups' ? 'page' : undefined} aria-label={t('shareFlat.ariaGroupsCount', { count: groupList.length })} className={'seg shrink-0 text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-300 flex items-center gap-2' + (tab === 'groups' ? ' active' : '')}><Icon name="users-round" className="w-4 h-4" /> {t('shareFlat.tabGroups')}</button>
      </HScroll>
      <div className="hidden sm:block flex-1" />
      {tab === 'rooms' && <button onClick={listRoom} className="btn-teal h-10 inline-flex items-center justify-center gap-2 px-4 rounded-full text-white text-sm font-semibold w-full sm:w-auto shrink-0"><Icon name="plus" className="w-4 h-4" /> {t('shareFlat.listYourRoom')}</button>}
      {tab === 'groups' && <button onClick={createGroup} className="btn-teal h-10 inline-flex items-center justify-center gap-2 px-4 rounded-full text-white text-sm font-semibold w-full sm:w-auto shrink-0"><Icon name="plus" className="w-4 h-4" /> {t('shareFlat.createGroup')}</button>}
    </div>
  );

  return {
    filters, setFilters, setF, sortMode, onSort,
    mapAreas, setMapAreas, toggleMapArea, mapGated, mapItems,
    filtersActive, clearFilters, activeFilterCount,
    seekerList, roomList, groupList, byLocality, gateAreas,
    kindWord, seg, budgetLbl, raiseHint, smartSearchFlat, shareTabs,
  };
}
