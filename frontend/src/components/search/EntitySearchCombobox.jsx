import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import PoweredByGoogle from '../ui/PoweredByGoogle.jsx';
import Button from '../ui/Button.jsx';
import { NEARBY, popularFor } from '../../data/homeData.js';
import { listProperties } from '../../services/propertyService.js';
import { localityByName, slugifyLocality, matchLocalityToCanonical, nearestLocality } from '../../data/localities.js';
import { buildEntityIndex, searchEntities, KIND_ICON } from '../../lib/searchEntities.js';
import { useSocietyCatalogue } from '../../lib/useSocietyCatalogue.js';
import { newAutocompleteSession, fetchSuggestions, fetchPlaceDetails } from '../../lib/places.js';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';

const EMPTY = [];

function localityTokenFromName(name, index) {
  const l = localityByName(name);
  const slug = l ? l.slug : slugifyLocality(name);
  return { kind: 'locality', id: slug, slug, label: l ? l.name : name, sublabel: 'Locality', count: index?.locCount?.get(slug) || 0 };
}

export default function EntitySearchCombobox({
  idPrefix = '',
  deal = 'buy',
  tokens = EMPTY,
  onTokensChange,
  query = '',
  onQueryChange,
  onRowsChange,
  onRemove,
  onSubmit,
  onFocus,
  showDoneActions = false,
  closeSignal = null,
  className = '',
  inputClassName = '',
}) {
  const { t: tr } = useTranslation();
  const inputId = `${idPrefix}hero-search-input`;
  const listboxId = `${idPrefix}loc-listbox`;
  const optId = (i) => `${idPrefix}loc-opt-${i}`;
  const { city } = useCity();
  const hasData = cityHasData(city);
  const popular = useMemo(() => popularFor(city), [city]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [gsug, setGsug] = useState([]);
  const [resolving, setResolving] = useState(false);
  const [listings, setListings] = useState([]);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const tokensRef = useRef(tokens);
  const sessionRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const countLabel = (n) => (n > 0 ? tr('home.search.listings', { count: n }) : tr('home.search.noListings'));

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    if (closeSignal != null) setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!hasData) { setListings([]); return undefined; }
    let alive = true;
    listProperties({}, 'newest')
      .then((rows) => { if (alive) setListings(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [hasData]);

  const catalogueReady = useSocietyCatalogue();
  const index = useMemo(
    () => buildEntityIndex(hasData ? listings.filter((p) => p.status === 'approved' && p.deal === deal) : []),
    [listings, deal, hasData, catalogueReady],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const chosenKeys = useMemo(() => new Set(tokens.map((t) => `${t.kind}:${t.id}`)), [tokens]);

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (q) return searchEntities(q, index, { limit: 8 }).filter((e) => !chosenKeys.has(`${e.kind}:${e.id}`));
    const picked = tokens.filter((t) => t.kind === 'locality');
    let names = popular;
    if (picked.length) {
      const near = [];
      picked.forEach((t) => (NEARBY[t.label] || []).forEach((n) => { if (!near.includes(n)) near.push(n); }));
      if (near.length) names = near;
    }
    return names.map((name) => localityTokenFromName(name, index))
      .filter((e) => !chosenKeys.has(`locality:${e.id}`))
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 8);
  }, [query, index, tokens, chosenKeys, popular]);

  const heading = query.trim()
    ? tr('home.search.headingEntities')
    : tokens.some((t) => t.kind === 'locality') ? tr('home.search.headingNearby') : tr('home.search.headingPopular');

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) { setGsug([]); return undefined; }
    const id = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      if (!sessionRef.current) sessionRef.current = newAutocompleteSession();
      const preds = await fetchSuggestions(q, sessionRef.current);
      if (id !== reqIdRef.current) return;
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

  const rows = useMemo(() => (query.trim() ? [...suggestions, ...gsug] : suggestions), [query, suggestions, gsug]);

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  const addToken = (token) => {
    if (!token) return;
    let nextTokens = tokensRef.current.some((t) => t.kind === token.kind && t.id === token.id) ? tokensRef.current : [...tokensRef.current, token];
    if (onTokensChange) {
      onTokensChange((prev = EMPTY) => {
        const current = Array.isArray(prev) ? prev : EMPTY;
        nextTokens = current.some((t) => t.kind === token.kind && t.id === token.id) ? current : [...current, token];
        tokensRef.current = nextTokens;
        return nextTokens;
      });
    } else {
      tokensRef.current = nextTokens;
    }
    onQueryChange?.('');
    setGsug([]);
  };

  const removeToken = (token) => {
    let nextTokens = tokensRef.current.filter((t) => !(t.kind === token.kind && t.id === token.id));
    if (onTokensChange) {
      onTokensChange((prev = EMPTY) => {
        const current = Array.isArray(prev) ? prev : EMPTY;
        nextTokens = current.filter((t) => !(t.kind === token.kind && t.id === token.id));
        tokensRef.current = nextTokens;
        return nextTokens;
      });
    } else {
      tokensRef.current = nextTokens;
    }
    onRemove?.(token, nextTokens);
  };

  const pickPlace = async (row) => {
    onQueryChange?.('');
    setGsug([]);
    setOpen(false);
    setResolving(true);
    let details = null;
    try { details = await fetchPlaceDetails(row); } catch { details = null; }
    sessionRef.current = null;
    setResolving(false);
    const lat = details ? details.lat : null;
    const lng = details ? details.lng : null;
    const selfName = details ? details.name : row.label;
    const selfLoc = selfName ? localityByName(selfName) : null;
    if (selfLoc) {
      addToken({ kind: 'locality', id: selfLoc.slug, slug: selfLoc.slug, label: selfLoc.name, sublabel: 'Locality', count: index.locCount.get(selfLoc.slug) || 0 });
      return;
    }
    if (lat != null && lng != null) {
      const parent = matchLocalityToCanonical(details.localityRaw || details.name, lat, lng) || nearestLocality(lat, lng, 6);
      addToken({ kind: 'place', id: row.id, label: row.label, sublabel: row.sublabel, near: `${lat},${lng}`, nearLabel: row.label, loc: parent ? parent.slug : null });
      return;
    }
    const canon = matchLocalityToCanonical(row.label);
    const slug = canon ? canon.slug : slugifyLocality(row.label);
    addToken({ kind: 'locality', id: slug, slug, label: canon ? canon.name : row.label, sublabel: 'Locality', count: index.locCount.get(slug) || 0 });
  };

  const pickRow = (row) => { if (row?.kind === 'place') pickPlace(row); else addToken(row); };

  useEffect(() => { setActiveIdx(-1); }, [query, tokens, open]);
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    listRef.current.querySelector(`#${optId(activeIdx)}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, idPrefix]);

  const onKeyDown = (e) => {
    const listOpen = open && rows.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (rows.length) setActiveIdx((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (rows.length) setActiveIdx((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (listOpen && activeIdx >= 0) pickRow(rows[activeIdx]);
      else if (query.trim() && rows.length) pickRow(rows[0]);
      else onSubmit?.();
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); }
    } else if (e.key === 'Backspace' && !query && tokens.length) {
      removeToken(tokens[tokens.length - 1]);
    }
  };

  const hasListbox = open && rows.length > 0;

  const focusInput = () => {
    setOpen(true);
    inputRef.current?.focus();
    onFocus?.();
  };

  return (
    <div ref={wrapRef} className={'entity-search-combobox relative ' + className}>
      <div onClick={focusInput} className="flex items-center flex-wrap gap-1.5 bg-white/5 rounded-xl px-3 py-2 min-h-[48px] cursor-text">
        <Icon name="search" className="w-5 h-5 text-[#14b8a6] flex-shrink-0" />
        {tokens.map((token) => (
          <span key={`${token.kind}:${token.id}`} className="loc-chip">
            <Icon name={KIND_ICON[token.kind] || 'map-pin'} className="w-3 h-3 text-[#14b8a6]" />
            {token.label}
            <button type="button" aria-label={tr('home.search.removeArea', { label: token.label })} onClick={(e) => { e.stopPropagation(); removeToken(token); }}>
              <Icon name="x" className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          value={query}
          onChange={(e) => { onQueryChange?.(e.target.value); setOpen(true); }}
          onFocus={focusInput}
          onKeyDown={onKeyDown}
          type="text"
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-label={tr('home.search.ariaSearch')}
          aria-controls={!open || hasListbox ? listboxId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={hasListbox}
          aria-activedescendant={hasListbox && activeIdx >= 0 ? optId(activeIdx) : undefined}
          placeholder={tokens.length ? tr('home.search.placeholderAdd') : hasData ? tr('home.search.placeholderTry') : tr('home.search.placeholderCity', { city })}
          className={'flex-1 min-w-[140px] bg-transparent text-base sm:text-sm text-white placeholder-gray-500 outline-none ' + inputClassName}
        />
        {resolving ? <Icon name="loader" className="w-4 h-4 text-[#14b8a6] flex-shrink-0 animate-spin" /> : null}
      </div>
      {hasListbox ? (
        <div className="absolute left-0 top-full mt-2 w-[22rem] max-w-full rounded-xl search-dropdown p-1.5 z-[70] flex flex-col         max-h-[min(18rem,60vh)]">
                  <div id={listboxId} ref={listRef} role="listbox" aria-label={heading} className="min-h-0 flex-1 overflow-y-auto search-dd-scroll">
            {rows.map((row, i) => (
              <div key={`${row.kind}:${row.id}`}>
                <button
                  id={optId(i)}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  className={'loc-sugg' + (i === activeIdx ? ' active' : '') + (row.kind === 'place' ? ' loc-sugg--stack' : '') + (typeof row.count === 'number' && row.count === 0 ? ' loc-sugg--empty' : '')}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={(ev) => { ev.stopPropagation(); pickRow(row); }}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon name={KIND_ICON[row.kind] || 'map-pin'} className="w-4 h-4 text-[#14b8a6] flex-shrink-0" />
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{row.label}</span>
                      {row.kind === 'place' && row.sublabel ? <span className="loc-sugg-sub truncate">{row.sublabel}</span> : null}
                    </span>
                    <span className="loc-sugg-meta">
                      {typeof row.count === 'number' ? <span className="loc-sugg-count">{countLabel(row.count)}</span> : null}
                      {row.kind !== 'locality' && row.kind !== 'place' ? <span className="loc-sugg-kind">{tr('home.search.kind.' + row.kind)}</span> : null}
                    </span>
                  </span>
                  <span className="add"><Icon name="plus" className="w-3.5 h-3.5" /></span>
                </button>
              </div>
            ))}
            {gsug.length ? <div className="loc-attrib"><PoweredByGoogle /></div> : null}
          </div>
          {showDoneActions && tokens.length ? (
            <div className="mt-1.5 flex items-center gap-2 border-t border-white/10 pt-1.5">
              <button type="button" onClick={(ev) => { ev.stopPropagation(); setOpen(false); }} className="btn btn-secondary btn-sm">
                {tr('home.search.done')}
              </button>
              <Button type="button" onClick={(ev) => { ev.stopPropagation(); onSubmit?.(); }} variant="primary" size="sm" icon="search" className="flex-1">
                {tr('home.search.searchAreas', { count: tokens.length })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
