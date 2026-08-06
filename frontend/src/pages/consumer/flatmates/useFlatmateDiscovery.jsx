import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { LOCALITIES, LOCALITY_COORDS } from './constants.js';
import { TAB_MOVE_IN, TAB_TEAM_UP, tabOf, asKind, decorateRooms, bestPerPersonRent } from './model.js';
import { inr, perHead, sortPosts, seekerMatches, roomMatches, groupMatches, postMatches, withCoords } from './helpers.js';

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
export function useFlatmateDiscovery({ tab, setTab, viewMode, requests, rooms, groups, t, toast, myPost, reviewMap, openPostModal, onPost }) {
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
  const onSort = (s) => { if (s === 'match' && !myPost) { toast(t('flatmates.toastPostToRank')); openPostModal(); return; } setSortMode(s); };

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  // Switching tabs clears the filter that the destination tab can't honour, so a
  // stale "Sharing" (groups-only) or "Move-in" (flatmates/rooms-only) value never
  // lingers as an invisible, uncountable active filter after the control is hidden.
  // Switching tabs clears the filter that the destination tab can't honour, so a
  // stale "Sharing" (people-tab only) or "Attached bathroom" (place-tab only)
  // value never lingers as an invisible, uncountable active filter after the
  // control is hidden.
  const selectTab = (next) => {
    setTab(next);
    setMapAreas(new Set());
    setFilters((f) => ({
      ...f,
      sharing: next === TAB_TEAM_UP ? f.sharing : '',
      attachedBath: next === TAB_MOVE_IN ? f.attachedBath : false,
    }));
  };

  // Count of active narrowing filters (the free-text query doesn't count). Once a
  // seeker narrows with 2+ filters they've shown enough intent to be offered an
  // alert, so the "create an alert" card appears — mirroring the listings page,
  // which surfaces its alert card as the search tightens.
  const activeFilterCount = useMemo(() => Object.keys(emptyFilters).filter((k) => {
    if (k === 'q' || NEAR_TUNING_KEYS.includes(k)) return false;
    const def = emptyFilters[k];
    return Array.isArray(def) ? filters[k].length > 0 : filters[k] !== def;
  }).length, [filters]);

  // Whether any filter narrows the default view — drives the "Clear filters" CTA
  // in empty states. `q` is counted here (unlike activeFilterCount, which gates the
  // alert CTA on narrowing intent only) because a typed query is still something
  // "Clear filters" must be able to undo.
  const filtersActive = useMemo(() => activeFilterCount > 0 || filters.q !== '', [activeFilterCount, filters.q]);
  // Spread rather than assigning `emptyFilters` directly: handing the shared module
  // constant out as state would make one future `filters.habits.push(...)` corrupt
  // the app-wide default permanently.
  const clearFilters = () => { setFilters({ ...emptyFilters, habits: [] }); setMapAreas(new Set()); };

  // Standardise every post with per-post coordinates before it's filtered/mapped.
  // A room geocoded via the list-property flow keeps its real point; seeds and
  // locality-only posts get a stable centroid-derived point. This one funnel gives
  // cards, the map and the "Near a Place" radius filter a uniform listing-like shape
  // and backfills old localStorage posts with no migration write.
  // Tag each record with its kind once, here at the merge boundary, so every
  // consumer downstream branches on an explicit field instead of sniffing shapes.
  const requestsC = useMemo(() => requests.map(withCoords).map(asKind('seeker')), [requests]);
  // Rooms additionally carry their flat's occupancy ledger (how many people have
  // moved into the flat, and how far this room can still be shared), because the
  // owner's cap is declared once for the whole flat, not per room.
  const roomsC = useMemo(() => decorateRooms(rooms.map(withCoords).map(asKind('room'))), [rooms]);
  const groupsC = useMemo(() => groups.map(withCoords).map(asKind('group')), [groups]);

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

  /* The two feeds. A group splits by whether it already has an address: with one
     it is seats in a real flat and belongs beside rooms; without one it is a set
     of people still hunting, which is the same decision as a solo seeker.
     Each feed is re-sorted AS ONE LIST — merging two pre-sorted lists would
     otherwise stack all rooms above all groups regardless of the chosen sort. */
  const moveInList = useMemo(
    () => sortPosts([...roomList, ...groupList.filter((g) => tabOf(g) === TAB_MOVE_IN)], sortMode, myPost),
    [roomList, groupList, sortMode, myPost],
  );
  const teamUpList = useMemo(
    () => sortPosts([...seekerList, ...groupList.filter((g) => tabOf(g) === TAB_TEAM_UP)], sortMode, myPost),
    [seekerList, groupList, sortMode, myPost],
  );
  const activeList = tab === TAB_MOVE_IN ? moveInList : teamUpList;
  // Cross-tab rescue: when this feed is empty the other one may still hold stock
  // for the same filters, so an empty state can offer a real next step instead of
  // dead-ending on "widen your budget".
  const otherTab = tab === TAB_MOVE_IN ? TAB_TEAM_UP : TAB_MOVE_IN;
  const otherCount = (tab === TAB_MOVE_IN ? teamUpList : moveInList).length;
  const switchTab = () => selectTab(otherTab);

  // Empty-state intelligence: when a tab returns nothing AND budget is the binding
  // constraint, find the cheapest post that would match if budget were "Any" so the
  // empty state can say "the cheapest match is ₹X — raise your budget" instead of a
  // dead end. Only runs when the active list is empty (cheap, and the common case).
  const raiseHint = useMemo(() => {
    if (filters.budget >= 40000) return null;
    if (activeList.length) return null;
    const any = { ...filters, budget: 40000 };
    const pool = (tab === TAB_MOVE_IN
      ? [...roomsC, ...groupsC.filter((g) => tabOf(g) === TAB_MOVE_IN)]
      : [...requestsC.filter((r) => !(myPost && r.id === myPost.id)), ...groupsC.filter((g) => tabOf(g) === TAB_TEAM_UP)]
    ).filter((x) => postMatches(x, any, reviewMap[x.id]));
    if (!pool.length) return null;
    // Rooms are compared on their best achievable per-person price, matching the
    // filter — otherwise the hint would quote a number the filter never used.
    const min = Math.min(...pool.map((x) => (x.kind === 'group' ? perHead(x) : x.kind === 'room' ? bestPerPersonRent(x) : x.budget)));
    if (!(min > filters.budget)) return null; // budget wasn't the blocker
    return { price: min, budget: Math.min(40000, Math.ceil(min / 1000) * 1000) };
  }, [tab, filters, activeList, requestsC, roomsC, groupsC, reviewMap, myPost]);

  const byLocality = useMemo(() => {
    const m = {};
    const add = (loc, item) => { if (LOCALITY_COORDS[loc]) (m[loc] = m[loc] || []).push(item); };
    activeList.forEach((it) => {
      const locs = (it.localities && it.localities.length) ? it.localities : (it.locality ? [it.locality] : []);
      locs.forEach((l) => add(l, it));
    });
    return m;
  }, [activeList]);
  const kindWord = tab === TAB_MOVE_IN ? 'homes' : 'flatmates';

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

  const budgetLbl = filters.budget >= 40000 ? t('flatmates.any') : '≤ ' + inr(filters.budget);

  /* ─── Sizing scale for this page ───
     tab / cta: h-10 (40px), rounded-full — nav tabs and the primary Post button
     filter:    h-9  (36px), rounded-xl   — dropdowns and filter controls
     sheet cta: h-11 (44px)               — the one full-width mobile action
     Text is text-sm (14px) throughout, dropping to text-[13px] on narrow phones.
     (This block used to claim h-9/rounded-xl for *all* controls, which the very
     next line contradicted — the tabs have always been h-10/rounded-full.) */
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
    if (/\b(girl|woman|women|female)\b/.test(q)) { next.gender = 'female'; parts.push(t('flatmates.gWomen')); }
    else if (/\b(boy|man|men|male|guy)\b/.test(q)) { next.gender = 'male'; parts.push(t('flatmates.gMen')); }

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
    if (/\b(immediate|now|asap|urgent)\b/.test(q)) { next.moveIn = 'now'; parts.push(t('flatmates.immediate')); }
    else if (/\b(15\s*day|2\s*week)\b/.test(q)) { next.moveIn = isoInDays(15); parts.push(t('flatmates.partWithin15Days')); }
    else if (/\b(month|30\s*day)\b/.test(q)) { next.moveIn = isoInDays(30); parts.push(t('flatmates.partWithinMonth')); }

    // Verified detection
    if (/\b(verified|trusted)\b/.test(q)) { next.verifiedOnly = true; parts.push(t('flatmates.verifiedOnly')); }

    // Attached washroom detection (rooms) — a top seeker dealbreaker.
    if (/\battach(ed)?\b.*\b(bath|washroom|toilet)|private\s*(bath|washroom|toilet)/.test(q)) { next.attachedBath = true; parts.push(t('flatmates.attachedBath')); }

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
    toast(parts.length ? t('flatmates.smartSearchToast', { detail: parts.join(' · ') }) : t('flatmates.searchingQuery', { query: filters.q.trim() }), 'success');
  };

  /* Two tabs, split by the one question a seeker can always answer instantly:
     is there an address yet?

       Move in now — a real flat you can price, visit and take a room in.
       Team up     — people to form a household with, before any flat exists.

     The old deck split by record type (Flatmates / Rooms / Groups), which asked
     the user to learn our storage model: a room in a flat and a group that has
     a flat are the same decision, while a group still hunting is not. Two tabs
     also fit a 360px phone comfortably, which is what finally leaves room to
     render the counts. */
  const tabCls = (on) =>
    'seg flex-1 sm:flex-none min-w-0 justify-center sm:justify-start text-[13px] sm:text-sm font-semibold px-2.5 sm:px-4 py-2.5 rounded-xl text-gray-300 flex items-center gap-1.5 sm:gap-2'
    + (on ? ' active' : '');
  /* Counts are RENDERED, not just announced to screen readers. Stock a seeker
     cannot see is stock they never switch tabs for — the single biggest reason
     the previous deck went unexplored. A zero count stays visible but dimmed, so
     "nothing here" is a fact rather than a mystery. */
  const tabCount = (n) => (
    <span className={'ml-0.5 shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ' + (n ? 'bg-white/10 text-gray-100' : 'bg-white/5 text-gray-500')}>{n}</span>
  );
  const flatmateTabs = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex items-center gap-2">
        <button onClick={() => selectTab(TAB_MOVE_IN)} aria-current={tab === TAB_MOVE_IN ? 'page' : undefined} aria-label={t('flatmates.ariaMoveInCount', { count: moveInList.length })} className={tabCls(tab === TAB_MOVE_IN)}>
          <Icon name="door-open" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.tabMoveIn')}</span>{tabCount(moveInList.length)}
        </button>
        <button onClick={() => selectTab(TAB_TEAM_UP)} aria-current={tab === TAB_TEAM_UP ? 'page' : undefined} aria-label={t('flatmates.ariaTeamUpCount', { count: teamUpList.length })} className={tabCls(tab === TAB_TEAM_UP)}>
          <Icon name="users-round" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.tabTeamUp')}</span>{tabCount(teamUpList.length)}
        </button>
      </div>
      <div className="hidden sm:block flex-1" />
      {/* One posting entry for the whole page. Which form you get is decided by
          answering "do you have a place?", not by guessing which tab to stand on
          first. */}
      <button onClick={onPost} className="btn-teal h-10 inline-flex items-center justify-center gap-2 px-4 rounded-full text-white text-sm font-semibold w-full sm:w-auto shrink-0">
        <Icon name="plus" className="w-4 h-4" /> {t('flatmates.postCta')}
      </button>
    </div>
  );

  return {
    filters, setFilters, setF, sortMode, onSort,
    mapAreas, setMapAreas, toggleMapArea, mapGated, mapItems,
    filtersActive, clearFilters, activeFilterCount,
    seekerList, roomList, groupList, moveInList, teamUpList, activeList,
    otherTab, otherCount, switchTab, byLocality, gateAreas,
    kindWord, seg, budgetLbl, raiseHint, smartSearchFlat, flatmateTabs,
  };
}
