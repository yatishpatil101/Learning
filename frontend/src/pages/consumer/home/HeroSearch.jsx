import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { NEARBY, TYPE_OPTS, PG_SHARING, COMMERCIAL_TYPES, LAND_USE, popularFor } from '../../../data/homeData.js';
import { pushRecentSearch } from '../../../lib/store.js';
import { listProperties } from '../../../services/propertyService.js';
import { localityByName, slugifyLocality, matchLocalityToCanonical, nearestLocality } from '../../../data/localities.js';
import { buildEntityIndex, searchEntities, paramsFromTokens, KIND_ICON } from '../../../lib/searchEntities.js';
import { useSocietyCatalogue } from '../../../lib/useSocietyCatalogue.js';
import { newAutocompleteSession, fetchSuggestions, fetchPlaceDetails } from '../../../lib/places.js';
import { useCity } from '../../../context/CityContext.jsx';
import { cityHasData } from '../../../lib/geoConfig.js';
import PoweredByGoogle from '../../../components/ui/PoweredByGoogle.jsx';
import Button from '../../../components/ui/Button.jsx';

// `idPrefix` exists because the mobile search sheet renders a second instance of
// this panel while the hero's copy is still in the DOM (display:none below lg).
// Duplicate element ids are invalid HTML and break aria-controls resolution, so
// the sheet namespaces its own. Default keeps the historic ids untouched.
export default function HeroSearch({ idPrefix = '' }) {
  const inputId = `${idPrefix}hero-search-input`;
  const listboxId = `${idPrefix}loc-listbox`;
  const optId = (i) => `${idPrefix}loc-opt-${i}`;
  const { t: tr } = useTranslation();
  const navigate = useNavigate();
  // Active city gates the instant registry (Pune-only today) and the popular empty-state,
  // so a data-less city never surfaces Pune localities — typed Google search stays live and
  // city-biased via the geo policy.
  const { city } = useCity();
  const hasData = cityHasData(city);
  // Memoise so the identity is stable per city — the empty-query `suggestions` memo and the
  // Google-suggestions effect depend on it; a fresh array each render would loop them.
  const popular = useMemo(() => popularFor(city), [city]);
  // Live-stock label for a suggestion row (per active tab). Registry-backed rows carry
  // a `count`; Google `place` rows don't (undefined) → no badge. 0 renders as a muted
  // "No listings" so a user never picks a dead area without knowing.
  const countLabel = (n) => (n > 0 ? tr('home.search.listings', { count: n }) : tr('home.search.noListings'));
  const [tab, setTab] = useState('buy');
  // Chosen entities — localities / societies / landmarks the user has picked.
  const [tokens, setTokens] = useState([]);
  const [query, setQuery] = useState('');
  const [typeKey, setTypeKey] = useState('');
  // Third dropdown's chosen option KEY ('' = nothing picked). Which option family
  // it holds follows the property type — see `detail` below.
  const [detailVal, setDetailVal] = useState('');
  const [open, setOpen] = useState(null); // 'loc' | 'type' | 'detail' | null
  const [activeIdx, setActiveIdx] = useState(-1);
  // Long-tail Google Places suggestions layered under the instant registry results,
  // plus a resolving flag while a picked place's coordinates are being fetched.
  const [gsug, setGsug] = useState([]);
  const [resolving, setResolving] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const sessionRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  // Approved stock feeds the live-listing counts that gate society/landmark
  // suggestions, so a suggestion can never lead to an empty results page. Only
  // fetched for cities we have inventory for — a data-less city keeps this empty
  // so no Pune stock ever sits in memory behind its city-aware search.
  const [listings, setListings] = useState([]);
  useEffect(() => {
    if (!hasData) { setListings([]); return undefined; }
    let alive = true;
    listProperties({}, 'newest')
      .then((rows) => { if (alive) setListings(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [hasData]);
  /* buildEntityIndex() resolves every listing to a society to count homes per society.
     No *seed* listing carries a societyId, but a user who has posted one does — and
     SocietySelect binds to RERA societies. Before the chunk lands societyById() misses,
     the count lands on a wrong curated society via the hash fallback, and without this
     dep the memo never rebuilds: the phantom count and the missing real suggestion both
     survive the whole session. */
  const catalogueReady = useSocietyCatalogue();
  const index = useMemo(
    () => buildEntityIndex(hasData ? listings.filter((p) => p.status === 'approved' && p.deal === tab) : []),
    [listings, tab, hasData, catalogueReady], // eslint-disable-line react-hooks/exhaustive-deps -- invalidation signal for the module-level society store; see `lib/useSocietyCatalogue.js`.
  );

  // Close any open dropdown when clicking outside the widget.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const typeLabel = (TYPE_OPTS[tab].find(([k]) => k === typeKey) || [])[1] || tr('home.search.typePlaceholder');

  /* ---------- type-aware third dropdown ----------
     Bedrooms are meaningless for a shop, an open plot or a farm, so each property
     type gets the sub-filter the Listings filter panel already offers it — same
     options, same URL params (`ctype` / `landuse` / `sharing` / `bhk`) — instead of
     a BHK list that can only produce a dead-end search.
     `opts` are [key, label] pairs; `param` is the Listings URL param the key
     travels in (null for flatmates, which routes to /flatmates instead). */
  const DETAIL = {
    flatmates: { icon: 'users', label: tr('home.search.roomForLabel'), param: null, opts: [['any', 'Anyone'], ['female', 'Women'], ['male', 'Men']] },
    pg: { icon: 'bed-double', label: tr('home.search.sharingLabel'), param: 'sharing', opts: PG_SHARING },
    commercial: { icon: 'briefcase', label: tr('home.search.commercialTypeLabel'), param: 'ctype', opts: COMMERCIAL_TYPES },
    plot: { icon: 'map', label: tr('home.search.landUseLabel'), param: 'landuse', opts: LAND_USE },
    farmland: { icon: 'trees', label: tr('home.search.landUseLabel'), param: 'landuse', opts: LAND_USE },
  };
  const BHK_DETAIL = { icon: 'bed-double', label: tr('home.search.bhkLabel'), param: 'bhk', opts: [['0', '1 RK'], ['1', '1 BHK'], ['2', '2 BHK'], ['3', '3 BHK'], ['3plus', '3+ BHK']] };
  const detail = DETAIL[typeKey] || BHK_DETAIL;
  const detailLabel = (detail.opts.find(([k]) => k === detailVal) || [])[1] || detail.label;

  const chosenKeys = useMemo(() => new Set(tokens.map((t) => `${t.kind}:${t.id}`)), [tokens]);

  const suggestions = useMemo(() => {
    // Turn a bare locality NAME (from POPULAR/NEARBY) into a registry-backed token.
    const localityTokenByName = (name) => {
      const l = localityByName(name);
      const slug = l ? l.slug : slugifyLocality(name);
      return { kind: 'locality', id: slug, slug, label: l ? l.name : name, sublabel: 'Locality', count: index.locCount.get(slug) || 0 };
    };
    const q = query.trim();
    if (q) return searchEntities(q, index, { limit: 8 }).filter((e) => !chosenKeys.has(`${e.kind}:${e.id}`));
    // Empty query: surface popular (or nearby, once a locality is picked) localities.
    const picked = tokens.filter((t) => t.kind === 'locality');
    let names = popular;
    if (picked.length) {
      const near = [];
      picked.forEach((t) => (NEARBY[t.label] || []).forEach((n) => { if (!near.includes(n)) near.push(n); }));
      if (near.length) names = near;
    }
    return names.map(localityTokenByName).filter((e) => !chosenKeys.has(`locality:${e.id}`))
      // Re-rank the popular empty-state by live stock for the active tab so a
      // high-inventory area surfaces first and a 0-stock one sinks (still shown for
      // discovery, just de-emphasised in the row).
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 8);
  }, [query, index, tokens, chosenKeys, popular]);

  const heading = query.trim()
    ? tr('home.search.headingEntities')
    : tokens.some((t) => t.kind === 'locality') ? tr('home.search.headingNearby') : tr('home.search.headingPopular');

  // Debounced Google Places lookup for the long tail — any real Pune locality,
  // society or landmark that isn't in our registry. Unfiltered (no type collection)
  // so societies/apartments surface alongside areas — a society like "Aspiria" is an
  // establishment, which a geocode-only filter would hide; the shared city fence +
  // blacklist inside fetchSuggestions still scope results to the active city. Deduped
  // against the instant registry rows + chosen chips; fails soft to [] when the SDK/key
  // is unavailable.
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) { setGsug([]); return undefined; }
    const id = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      if (!sessionRef.current) sessionRef.current = newAutocompleteSession();
      const preds = await fetchSuggestions(q, sessionRef.current);
      if (id !== reqIdRef.current) return; // a newer keystroke superseded this one
      const seen = new Set(suggestions.map((e) => e.label.toLowerCase()));
      tokens.forEach((t) => seen.add(t.label.toLowerCase()));
      const rows = [];
      for (const p of preds) {
        const key = (p.mainText || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({ kind: 'place', id: p.placeId, placeId: p.placeId, label: p.mainText, sublabel: p.secondaryText, _p: p._p });
        if (rows.length >= 5) break;
      }
      setGsug(rows);
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, suggestions, tokens]);

  // Registry results first (instant, stock-gated), then the Google long tail.
  const rows = query.trim() ? [...suggestions, ...gsug] : suggestions;

  const addToken = (e) => {
    if (!e) return;
    setTokens((p) => (p.some((t) => t.kind === e.kind && t.id === e.id) ? p : [...p, e]));
    setQuery('');
    setGsug([]);
  };
  const removeToken = (e) => setTokens((p) => p.filter((t) => !(t.kind === e.kind && t.id === e.id)));

  // Resolve a Google pick to coordinates, then:
  //  - if the pick is ITSELF a known locality (by name) → a `loc` locality chip;
  //  - otherwise (a society / landmark / POI) → a `place` chip that carries BOTH a
  //    proximity point (shown by its real NAME) AND its VERIFIED parent locality, so
  //    Listings fills "Near a Place" + the matching Localities chip. A Google pick can
  //    never dead-end. A new billing session begins after each committed pick.
  const pickPlace = async (e) => {
    setQuery('');
    setGsug([]);
    setOpen(null);
    setResolving(true);
    let details = null;
    try { details = await fetchPlaceDetails(e); } catch { details = null; }
    sessionRef.current = null;
    setResolving(false);
    const lat = details ? details.lat : null;
    const lng = details ? details.lng : null;
    // The pick is itself a locality only when its OWN name matches a registry
    // locality — never infer this from coordinates (that would misread a society
    // sitting inside a locality as the locality itself, dropping the society).
    const selfName = details ? details.name : e.label;
    const selfLoc = selfName ? localityByName(selfName) : null;
    if (selfLoc) {
      addToken({ kind: 'locality', id: selfLoc.slug, slug: selfLoc.slug, label: selfLoc.name, sublabel: 'Locality', count: index.locCount.get(selfLoc.slug) || 0 });
      return;
    }
    if (lat != null && lng != null) {
      // Verified parent locality: named area first (localityRaw, e.g. "Hinjawadi"),
      // then a coordinate snap within 6 km. Null when nothing confident is nearby.
      const parent =
        matchLocalityToCanonical(details.localityRaw || details.name, lat, lng) ||
        nearestLocality(lat, lng, 6);
      addToken({ kind: 'place', id: e.id, label: e.label, sublabel: e.sublabel, near: `${lat},${lng}`, nearLabel: e.label, loc: parent ? parent.slug : null });
      return;
    }
    // Last resort (no coords): snap the label to a canonical locality if we can,
    // else treat it as a locality name.
    const canon = matchLocalityToCanonical(e.label);
    const slug = canon ? canon.slug : slugifyLocality(e.label);
    addToken({ kind: 'locality', id: slug, slug, label: canon ? canon.name : e.label, sublabel: 'Locality', count: index.locCount.get(slug) || 0 });
  };

  // Commit a chosen row — Google places resolve async; registry rows add instantly.
  const pickRow = (e) => { if (e && e.kind === 'place') pickPlace(e); else addToken(e); };

  useEffect(() => { setActiveIdx(-1); }, [query, tokens, open]);
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    listRef.current.querySelector(`#${optId(activeIdx)}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, idPrefix]);

  const switchTab = (t) => { setTab(t); setTypeKey(''); setDetailVal(''); };
  // Clearing the detail on type change matters: the option families are disjoint,
  // so a leftover '2 BHK' must never ride along with a newly picked Open Plot.
  const pickType = (key) => { setTypeKey(key); setDetailVal(''); setOpen(null); };

  const recordSearch = (url, parts) => {
    const label = parts.filter(Boolean).join(' · ');
    if (label) pushRecentSearch({ label, url });
  };

  const doSearch = () => {
    if (tab === 'rent' && typeKey === 'flatmates') {
      const locTok = tokens.find((t) => t.kind === 'locality');
      const loc = locTok ? locTok.label : query.trim();
      const g = detailVal === 'male' || detailVal === 'female' ? detailVal : '';
      const sp = new URLSearchParams({ view: 'move-in' });
      if (loc) sp.set('loc', loc);
      if (g) sp.set('g', g);
      const url = '/flatmates?' + sp.toString();
      recordSearch(url, ['Flatmate', loc, detailVal ? detailLabel : '']);
      navigate(url);
      return;
    }
    const p = new URLSearchParams();
    p.set('deal', tab);
    // If the user typed a locality/society/landmark but hit Search without
    // explicitly picking a chip, promote the best matching registry suggestion so
    // it travels as a real filter (loc/soc/near) and shows up in the Listings
    // filter panel — instead of a weak free-text query that never does. Mirrors
    // what pressing Enter on the first suggestion already does. Google-only
    // long-tail text (no registry match) still falls back to a plain query.
    let effTokens = tokens;
    if (!effTokens.length && query.trim()) {
      const promote = rows.find((r) => r.kind === 'locality' || r.kind === 'society' || r.kind === 'landmark');
      if (promote) effTokens = [promote];
    }
    // Chosen entities land as filter chips on Listings; free-typed text with no
    // registry match stays a plain query so the user still gets results.
    const parts = paramsFromTokens(effTokens);
    Object.entries(parts).forEach(([k, v]) => p.set(k, v));
    if (!effTokens.length && query.trim()) p.set('q', query.trim());
    if (typeKey) p.set('ptype', typeKey);
    if (detailVal && detail.param) p.set(detail.param, detailVal);
    const url = '/listings?' + p.toString();
    const locLabel = effTokens.length ? effTokens.map((t) => t.label).join(', ') : query.trim();
    recordSearch(url, [tab === 'rent' ? 'Rent' : 'Buy', typeKey ? typeLabel : '', detailVal ? detailLabel : '', locLabel]);
    navigate(url);
  };

  const onLocKeyDown = (e) => {
    const listOpen = open === 'loc' && rows.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open !== 'loc') { setOpen('loc'); return; }
      if (rows.length) setActiveIdx((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open !== 'loc') { setOpen('loc'); return; }
      if (rows.length) setActiveIdx((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (listOpen && activeIdx >= 0) pickRow(rows[activeIdx]);
      else if (query.trim() && rows.length) pickRow(rows[0]);
      else doSearch();
    } else if (e.key === 'Escape') {
      if (open === 'loc') { e.preventDefault(); setOpen(null); }
    } else if (e.key === 'Backspace' && !query && tokens.length) {
      removeToken(tokens[tokens.length - 1]);
    }
  };

  return (
    <div ref={wrapRef} className="hero-search-wrap max-w-3xl mx-auto mb-8">
      {/* Tabs — min-h-[44px] below sm because switching Buy/Rent is a first-class
         decision and py-2 alone lands at ~34px, under the touch minimum. */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <button onClick={() => switchTab('buy')} className={'search-tab min-h-[44px] sm:min-h-0 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'buy' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.buy')}</button>
        <button onClick={() => switchTab('rent')} className={'search-tab min-h-[44px] sm:min-h-0 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'rent' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.rent')}</button>
      </div>

      <div className="glass-strong rounded-2xl p-2 sm:p-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Multi-entity search: localities, societies or landmarks */}
          <div className="flex-1 relative">
            <div onClick={() => setOpen('loc')} className="flex items-center flex-wrap gap-1.5 bg-white/5 rounded-xl px-3 py-2 min-h-[48px] cursor-text">
              <Icon name="search" className="w-5 h-5 text-[#14b8a6] flex-shrink-0" />
              {tokens.map((t) => (
                <span key={`${t.kind}:${t.id}`} className="loc-chip">
                  <Icon name={KIND_ICON[t.kind] || 'map-pin'} className="w-3 h-3 text-[#14b8a6]" />
                  {t.label}
                  <button type="button" aria-label={tr('home.search.removeArea', { label: t.label })} onClick={(e) => { e.stopPropagation(); removeToken(t); }}>
                    <Icon name="x" className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                id={inputId}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen('loc'); }}
                onFocus={() => setOpen('loc')}
                onKeyDown={onLocKeyDown}
                type="text"
                autoComplete="off"
                enterKeyHint="search"
                role="combobox"
                aria-label={tr('home.search.ariaSearch')}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={open === 'loc'}
                aria-activedescendant={open === 'loc' && activeIdx >= 0 ? optId(activeIdx) : undefined}
                placeholder={tokens.length ? tr('home.search.placeholderAdd') : hasData ? tr('home.search.placeholderTry') : tr('home.search.placeholderCity', { city })}
                className="flex-1 min-w-[140px] bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              />
              {resolving ? <Icon name="loader" className="w-4 h-4 text-[#14b8a6] flex-shrink-0 animate-spin" /> : null}
            </div>
            {open === 'loc' && rows.length ? (
              <div className="absolute left-0 top-full mt-2 w-[22rem] max-w-full rounded-xl search-dropdown p-1.5 z-[70] flex flex-col max-h-[min(18rem,60vh)]">
                <div id={listboxId} ref={listRef} role="listbox" aria-label={heading} className="min-h-0 flex-1 overflow-y-auto search-dd-scroll">
                  {rows.map((e, i) => (
                    <div key={`${e.kind}:${e.id}`}>
                      <button
                        id={optId(i)}
                        type="button"
                        role="option"
                        aria-selected={i === activeIdx}
                        className={'loc-sugg' + (i === activeIdx ? ' active' : '') + (e.kind === 'place' ? ' loc-sugg--stack' : '') + (typeof e.count === 'number' && e.count === 0 ? ' loc-sugg--empty' : '')}
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={(ev) => { ev.stopPropagation(); pickRow(e); }}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon name={KIND_ICON[e.kind] || 'map-pin'} className="w-4 h-4 text-[#14b8a6] flex-shrink-0" />
                          <span className="flex flex-col min-w-0">
                            <span className="truncate">{e.label}</span>
                            {e.kind === 'place' && e.sublabel ? <span className="loc-sugg-sub truncate">{e.sublabel}</span> : null}
                          </span>
                          <span className="loc-sugg-meta">
                            {typeof e.count === 'number' ? <span className="loc-sugg-count">{countLabel(e.count)}</span> : null}
                            {e.kind !== 'locality' && e.kind !== 'place' ? <span className="loc-sugg-kind">{tr('home.search.kind.' + e.kind)}</span> : null}
                          </span>
                        </span>
                        <span className="add"><Icon name="plus" className="w-3.5 h-3.5" /></span>
                      </button>
                    </div>
                  ))}
                  {gsug.length ? (
                    <div className="loc-attrib"><PoweredByGoogle /></div>
                  ) : null}
                </div>
                {/* Sticky "I'm done" bar — the standard mobile multi-select affordance.
                   Tap-outside/Esc are unreliable on phones (the panel overlays the
                   Search button, and there's no Esc key), so once an area is chosen we
                   surface an explicit way to close and go straight to results. */}
                {tokens.length ? (
                  <div className="mt-1.5 flex items-center gap-2 border-t border-white/10 pt-1.5">
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); setOpen(null); }}
                      className="btn btn-secondary btn-sm"
                    >
                      {tr('home.search.done')}
                    </button>
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); doSearch(); }}
                      className="btn btn-primary btn-sm flex-1"
                    >
                      <Icon name="search" className="w-4 h-4" />
                      {tr('home.search.searchAreas', { count: tokens.length })}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Type */}
          <div className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={open === 'type'} onClick={() => setOpen(open === 'type' ? null : 'type')} className={'w-full flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 text-sm hover:bg-white/10 transition-all whitespace-nowrap ' + (typeKey ? 'text-white' : 'text-gray-400 hover:text-white')}>
              <Icon name="building-2" className="w-4 h-4" />
              <span>{typeLabel}</span>
              <Icon name="chevron-down" className="w-3 h-3 ml-auto" />
            </button>
            {open === 'type' ? (
              <div className="absolute left-0 top-full mt-2 flex flex-col w-max min-w-full max-w-[calc(100vw-2rem)] max-h-[min(13rem,55vh)] search-dd-scroll rounded-xl search-dropdown shadow-2xl shadow-black/40 p-1.5 z-[60] text-left">
                {TYPE_OPTS[tab].map(([key, label, icon]) => (
                  <button key={key} className="search-dd-opt" onClick={() => pickType(key)}>
                    <Icon name={icon} className="w-4 h-4 text-[#14b8a6] flex-shrink-0" /> {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Type-aware detail — BHK, PG sharing, flatmate gender, commercial subtype or land use */}
          <div className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={open === 'detail'} onClick={() => setOpen(open === 'detail' ? null : 'detail')} className={'w-full flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 text-sm hover:bg-white/10 transition-all whitespace-nowrap ' + (detailVal ? 'text-white' : 'text-gray-400 hover:text-white')}>
              <Icon name={detail.icon} className="w-4 h-4" />
              <span>{detailLabel}</span>
              <Icon name="chevron-down" className="w-3 h-3 ml-auto" />
            </button>
            {open === 'detail' ? (
              <div className="absolute left-0 top-full mt-2 flex flex-col w-max min-w-full max-w-[calc(100vw-2rem)] max-h-[min(13rem,55vh)] search-dd-scroll rounded-xl search-dropdown shadow-2xl shadow-black/40 p-1.5 z-[60] text-left">
                {detail.opts.map(([key, label]) => (
                  <button key={key} className="search-dd-opt" onClick={() => { setDetailVal(key); setOpen(null); }}>{label}</button>
                ))}
              </div>
            ) : null}
          </div>

          <Button onClick={doSearch} variant="primary" size="lg" icon="search" className="search-btn">
            {tr('home.search.searchBtn')}
          </Button>
        </div>
      </div>
    </div>
  );
}
