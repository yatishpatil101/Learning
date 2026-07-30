import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { NEARBY, TYPE_OPTS, PG_SHARING, popularFor } from '../../../data/homeData.js';
import { pushRecentSearch } from '../../../lib/store.js';
import { listProperties } from '../../../services/propertyService.js';
import { localityByName, slugifyLocality, matchLocalityToCanonical, nearestLocality } from '../../../data/localities.js';
import { buildEntityIndex, searchEntities, paramsFromTokens, KIND_ICON } from '../../../lib/searchEntities.js';
import { newAutocompleteSession, fetchSuggestions, fetchPlaceDetails } from '../../../lib/places.js';
import { useCity } from '../../../context/CityContext.jsx';
import { cityHasData } from '../../../lib/geoConfig.js';
import PoweredByGoogle from '../../../components/ui/PoweredByGoogle.jsx';
import Button from '../../../components/ui/Button.jsx';

export default function HeroSearch() {
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
  const [bhkVal, setBhkVal] = useState('BHK');
  const [open, setOpen] = useState(null); // 'loc' | 'type' | 'bhk' | null
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
  const index = useMemo(
    () => buildEntityIndex(hasData ? listings.filter((p) => p.status === 'approved' && p.deal === tab) : []),
    [listings, tab, hasData],
  );

  // Close any open dropdown when clicking outside the widget.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const typeLabel = (TYPE_OPTS[tab].find(([k]) => k === typeKey) || [])[1] || tr('home.search.typePlaceholder');
  const isFlatmate = typeKey === 'flatmates';
  const isPg = typeKey === 'pg';
  const bhkPlaceholders = ['BHK', 'Room for', 'Sharing'];
  const bhkLabel = isFlatmate ? tr('home.search.roomForLabel') : isPg ? tr('home.search.sharingLabel') : tr('home.search.bhkLabel');
  const bhkOpts = isFlatmate
    ? ['Anyone', 'Women', 'Men']
    : isPg
      ? PG_SHARING.map(([, label]) => label)
      : ['1 RK', '1 BHK', '2 BHK', '3 BHK', '3+ BHK'];

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
    listRef.current.querySelector(`#loc-opt-${activeIdx}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const switchTab = (t) => { setTab(t); setTypeKey(''); setBhkVal('BHK'); };
  const pickType = (key) => { setTypeKey(key); setBhkVal('BHK'); setOpen(null); };

  const BHK_KEY = { '1 RK': '0', '1 BHK': '1', '2 BHK': '2', '3 BHK': '3', '3+ BHK': '3plus' };
  const SHARING_KEY = Object.fromEntries(PG_SHARING.map(([k, label]) => [label, k]));

  const recordSearch = (url, parts) => {
    const label = parts.filter(Boolean).join(' · ');
    if (label) pushRecentSearch({ label, url });
  };

  const doSearch = () => {
    if (tab === 'rent' && typeKey === 'flatmates') {
      const locTok = tokens.find((t) => t.kind === 'locality');
      const loc = locTok ? locTok.label : query.trim();
      let g = '';
      if (bhkVal === 'Men') g = 'male';
      else if (bhkVal === 'Women') g = 'female';
      const sp = new URLSearchParams({ view: 'rooms' });
      if (loc) sp.set('loc', loc);
      if (g) sp.set('g', g);
      const url = '/share-flat?' + sp.toString();
      recordSearch(url, ['Flatmate', loc, bhkVal !== 'Room for' ? bhkVal : '']);
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
    if (isPg && SHARING_KEY[bhkVal]) p.set('sharing', SHARING_KEY[bhkVal]);
    else if (BHK_KEY[bhkVal]) p.set('bhk', BHK_KEY[bhkVal]);
    const url = '/listings?' + p.toString();
    const locLabel = effTokens.length ? effTokens.map((t) => t.label).join(', ') : query.trim();
    recordSearch(url, [tab === 'rent' ? 'Rent' : 'Buy', typeKey ? typeLabel : '', !bhkPlaceholders.includes(bhkVal) ? bhkVal : '', locLabel]);
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
      {/* Tabs */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <button onClick={() => switchTab('buy')} className={'search-tab px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'buy' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.buy')}</button>
        <button onClick={() => switchTab('rent')} className={'search-tab px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'rent' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.rent')}</button>
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
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen('loc'); }}
                onFocus={() => setOpen('loc')}
                onKeyDown={onLocKeyDown}
                type="text"
                autoComplete="off"
                role="combobox"
                aria-label={tr('home.search.ariaSearch')}
                aria-controls="loc-listbox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={open === 'loc'}
                aria-activedescendant={open === 'loc' && activeIdx >= 0 ? `loc-opt-${activeIdx}` : undefined}
                placeholder={tokens.length ? tr('home.search.placeholderAdd') : hasData ? tr('home.search.placeholderTry') : tr('home.search.placeholderCity', { city })}
                className="flex-1 min-w-[140px] bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              />
              {resolving ? <Icon name="loader" className="w-4 h-4 text-[#14b8a6] flex-shrink-0 animate-spin" /> : null}
            </div>
            {open === 'loc' && rows.length ? (
              <div className="absolute left-0 top-full mt-2 w-[22rem] max-w-full rounded-xl search-dropdown p-1.5 z-[70] flex flex-col max-h-[min(18rem,60vh)]">
                <div id="loc-listbox" ref={listRef} role="listbox" aria-label={heading} className="min-h-0 flex-1 overflow-y-auto search-dd-scroll">
                  {rows.map((e, i) => (
                    <div key={`${e.kind}:${e.id}`}>
                      <button
                        id={`loc-opt-${i}`}
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

          {/* BHK / Flatmate */}
          <div className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={open === 'bhk'} onClick={() => setOpen(open === 'bhk' ? null : 'bhk')} className={'w-full flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 text-sm hover:bg-white/10 transition-all whitespace-nowrap ' + (!bhkPlaceholders.includes(bhkVal) ? 'text-white' : 'text-gray-400 hover:text-white')}>
              <Icon name={isFlatmate ? 'users' : 'bed-double'} className="w-4 h-4" />
              <span>{bhkPlaceholders.includes(bhkVal) ? bhkLabel : bhkVal}</span>
              <Icon name="chevron-down" className="w-3 h-3 ml-auto" />
            </button>
            {open === 'bhk' ? (
              <div className="absolute left-0 top-full mt-2 flex flex-col w-max min-w-full max-w-[calc(100vw-2rem)] max-h-[min(13rem,55vh)] search-dd-scroll rounded-xl search-dropdown shadow-2xl shadow-black/40 p-1.5 z-[60] text-left">
                {bhkOpts.map((v) => (
                  <button key={v} className="search-dd-opt" onClick={() => { setBhkVal(v); setOpen(null); }}>{v}</button>
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
