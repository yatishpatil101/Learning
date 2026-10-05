import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Button from '../../../components/ui/Button.jsx';
import EntitySearchCombobox from '../../../components/search/EntitySearchCombobox.jsx';
import { TYPE_OPTS, COMMERCIAL_TYPES, LAND_USE } from '../../../data/homeData.js';
import { BHK_OPTIONS } from '../../../lib/listings/bhkOptions.js';
import { paramsFromTokens } from '../../../lib/searchEntities.js';
import { recordRecentSearch } from '../../../services/recentSearchService.js';

const HERO_PREF_KEY = 'draazy.hero.v1';

function readHeroPrefs() {
  try {
    const value = JSON.parse(window.localStorage.getItem(HERO_PREF_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeHeroPrefs(value) {
  try {
    window.localStorage.setItem(HERO_PREF_KEY, JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export default function HeroSearch({ idPrefix = '' }) {
  const { t: tr } = useTranslation();
  const navigate = useNavigate();
  const [initialHeroPrefs] = useState(readHeroPrefs);
  const initialTab = initialHeroPrefs.tab === 'rent' ? 'rent' : 'buy';
  const initialType = TYPE_OPTS[initialTab].some(([key]) => key === initialHeroPrefs.typeKey) ? initialHeroPrefs.typeKey : '';
  const [tab, setTab] = useState(initialTab);
  const [tokens, setTokens] = useState([]);
  const [query, setQuery] = useState('');
  const [entityRows, setEntityRows] = useState([]);
  const [typeKey, setTypeKey] = useState(initialType);
  const [detailVal, setDetailVal] = useState(initialHeroPrefs.detailVal || '');
  const [open, setOpen] = useState(null);
  const wrapRef = useRef(null);

  const typeLabel = (TYPE_OPTS[tab].find(([k]) => k === typeKey) || [])[1] || tr('home.search.typePlaceholder');
  const DETAIL = {
    flatmates: { icon: 'users', label: tr('home.search.roomForLabel'), param: null, opts: [['any', 'Anyone'], ['female', 'Women'], ['male', 'Men']] },
    commercial: { icon: 'briefcase', label: tr('home.search.commercialTypeLabel'), param: 'ctype', opts: COMMERCIAL_TYPES },
    plot: { icon: 'map', label: tr('home.search.landUseLabel'), param: 'landuse', opts: LAND_USE },
    farmland: null,
  };
  const BHK_DETAIL = { icon: 'bed-double', label: tr('home.search.bhkLabel'), param: 'bhks', opts: BHK_OPTIONS[tab] };
  const detail = Object.prototype.hasOwnProperty.call(DETAIL, typeKey) ? DETAIL[typeKey] : BHK_DETAIL;
  const detailLabel = detail ? (detail.opts.find(([k]) => k === detailVal) || [])[1] || detail.label : '';

  useEffect(() => {
    if (!detail && detailVal) setDetailVal('');
    else if (detailVal && !detail.opts.some(([key]) => key === detailVal)) setDetailVal('');
  }, [detail, detailVal]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setTypeKey('');
    setDetailVal('');
    writeHeroPrefs({ tab: nextTab, typeKey: '', detailVal: '' });
  };

  const pickType = (key) => {
    setTypeKey(key);
    setDetailVal('');
    setOpen(null);
    writeHeroPrefs({ tab, typeKey: key, detailVal: '' });
  };

  const recordSearch = (url, parts) => {
    const label = parts.filter(Boolean).join(' · ');
    if (!label) return;
    recordRecentSearch({ label, url }).catch((e) => {
      console.warn('[recentSearch] could not record this search', e);
    });
  };

  const doSearch = () => {
    if (tab === 'rent' && typeKey === 'flatmates') {
      const locTok = tokens.find((token) => token.kind === 'locality');
      const loc = locTok ? locTok.label : query.trim();
      const gender = detailVal === 'male' || detailVal === 'female' ? detailVal : '';
      const sp = new URLSearchParams({ view: 'move-in' });
      if (loc) sp.set('loc', loc);
      if (gender) sp.set('g', gender);
      const url = '/flatmates?' + sp.toString();
      recordSearch(url, ['Flatmate', loc, detailVal ? detailLabel : '']);
      navigate(url);
      return;
    }

    const p = new URLSearchParams();
    p.set('deal', tab);
    let effectiveTokens = tokens;
    if (!effectiveTokens.length && query.trim()) {
      const promoted = entityRows.find((row) => row.kind === 'locality' || row.kind === 'society' || row.kind === 'landmark');
      if (promoted) effectiveTokens = [promoted];
    }
    const parts = paramsFromTokens(effectiveTokens);
    Object.entries(parts).forEach(([key, value]) => p.set(key, value));
    if (!effectiveTokens.length && query.trim()) p.set('q', query.trim());
    if (typeKey) p.set('ptype', typeKey);
    if (detailVal && detail?.param) p.set(detail.param, detailVal);
    const url = '/listings?' + p.toString();
    const locLabel = effectiveTokens.length ? effectiveTokens.map((token) => token.label).join(', ') : query.trim();
    recordSearch(url, [tab === 'rent' ? 'Rent' : 'Buy', typeKey ? typeLabel : '', detail && detailVal ? detailLabel : '', locLabel]);
    navigate(url);
  };

  return (
    <div ref={wrapRef} className="hero-search-wrap max-w-3xl mx-auto mb-8">
      <div className="flex items-center justify-center gap-2 mb-4">
        <button onClick={() => switchTab('buy')} className={'search-tab min-h-[44px] sm:min-h-0 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'buy' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.buy')}</button>
        <button onClick={() => switchTab('rent')} className={'search-tab min-h-[44px] sm:min-h-0 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ' + (tab === 'rent' ? 'pill-active' : 'text-gray-400 bg-white/5 hover:bg-white/10')}>{tr('home.search.rent')}</button>
      </div>

      <div className="glass-strong rounded-2xl p-2 sm:p-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 relative">
            <EntitySearchCombobox
              idPrefix={idPrefix}
              deal={tab}
              tokens={tokens}
              onTokensChange={setTokens}
              query={query}
              onQueryChange={setQuery}
              onRowsChange={setEntityRows}
              onSubmit={doSearch}
              onFocus={() => setOpen(null)}
              closeSignal={open}
              showDoneActions
            />
          </div>

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

          {detail ? (
            <div className="relative">
              <button type="button" aria-haspopup="listbox" aria-expanded={open === 'detail'} onClick={() => setOpen(open === 'detail' ? null : 'detail')} className={'w-full flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 text-sm hover:bg-white/10 transition-all whitespace-nowrap ' + (detailVal ? 'text-white' : 'text-gray-400 hover:text-white')}>
                <Icon name={detail.icon} className="w-4 h-4" />
                <span>{detailLabel}</span>
                <Icon name="chevron-down" className="w-3 h-3 ml-auto" />
              </button>
              {open === 'detail' ? (
                <div className="absolute left-0 top-full mt-2 flex flex-col w-max min-w-full max-w-[calc(100vw-2rem)] max-h-[min(13rem,55vh)] search-dd-scroll rounded-xl search-dropdown shadow-2xl shadow-black/40 p-1.5 z-[60] text-left">
                  {detail.opts.map(([key, label]) => (
                    <button key={key} className="search-dd-opt" onClick={() => { setDetailVal(key); setOpen(null); writeHeroPrefs({ tab, typeKey, detailVal: key }); }}>{label}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <Button onClick={doSearch} variant="primary" size="lg" icon="search" className="search-btn">
            {tr('home.search.searchBtn')}
          </Button>
        </div>
      </div>
    </div>
  );
}
