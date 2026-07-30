import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { getSavedProps, toggleSavedProp, addSavedSearch } from '../../lib/store.js';
import { getPropertiesByIds } from '../../services/propertyService.js';
import { fmtINR } from '../../lib/format.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import { useToast } from '../../context/ToastContext.jsx';

const SHARE_KEY = 'puneNestShareSaved';

const CATEGORIES = [
  { key: 'buy', label: 'For Sale', labelKey: 'catBuyLabel', icon: 'home', desc: 'Properties you want to buy', descKey: 'catBuyDesc' },
  { key: 'rent', label: 'For Rent', labelKey: 'catRentLabel', icon: 'key', desc: 'Rentals you shortlisted', descKey: 'catRentDesc' },
  { key: 'share', label: 'Flatmates & Flat-shares', labelKey: 'catShareLabel', shortKey: 'catShareShort', short: 'Flatmates', icon: 'users-round', desc: 'Shared living saves', descKey: 'catShareDesc' },
];

const SORTS = [['newest', 'Newest', 'sortNewest'], ['price-desc', 'Price: High to Low', 'sortPriceHigh'], ['price-asc', 'Price: Low to High', 'sortPriceLow']];

const statusLabelFor = (status) => {
  if (!status || status === 'active') return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

export default function Saved() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState('buy');
  const [sort, setSort] = useState('newest');
  const [removing, setRemoving] = useState(() => new Set());

  const [dynamicSaved, setDynamicSaved] = useState([]);

  // Load hearted properties from pnSavedProps store on mount
  useEffect(() => {
    const savedIds = getSavedProps();
    if (savedIds.length) {
      // Resolve the saved ids directly — the page only ever renders these, so downloading the
      // catalogue to filter it down to them scaled with the market rather than with the user.
      getPropertiesByIds(savedIds).then((matched) => {
        const cardsFromStore = matched.map((p) => {
          const isRent = p.deal === 'rent';
          return {
            id: p.id,
            cat: isRent ? 'rent' : 'buy',
            title: p.title || p.type || 'Property',
            loc: p.locality ? `${p.locality}, Pune` : 'Pune',
            price: typeof p.price === 'number' ? (isRent ? `₹${p.price.toLocaleString('en-IN')}/mo` : fmtINR(p.price)) : (p.price || ''),
            priceNum: typeof p.price === 'number' ? p.price : 0,
            createdAt: p.createdAt || 0,
            statusLabel: statusLabelFor(p.status),
            deal: isRent ? 'rent' : 'buy',
            localitySlug: p.locality || '',
            bhkNum: p.bhkNum || null,
            badge: isRent ? 'For Rent' : 'For Sale',
            bhk: p.bhk || (p.bhkNum ? `${p.bhkNum} BHK` : ''),
            area: p.area ? `${p.area.toLocaleString('en-IN')} sq.ft.` : '',
            bath: p.bath ? `${p.bath} Bath` : '',
            img: p.image || p.img || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80',
            fromStore: true,
          };
        });
        setDynamicSaved(cardsFromStore);
      });
    }
  }, []);

  const [cards, setCards] = useState(() => {
    const savedMap = {};
    try {
      const stored = localStorage.getItem(SHARE_KEY);
      if (stored) Object.assign(savedMap, JSON.parse(stored));
    } catch (e) {}

    const shareCards = Object.keys(savedMap).map((k) => {
      const v = savedMap[k];
      if (!v || typeof v !== 'object') return null;
      return {
        id: k,
        cat: 'share',
        kind: v.kind || 'flatmate',
        title: v.title || 'Saved item',
        loc: v.loc || 'Pune',
        price: v.price || '',
        badge: v.badge || (v.kind === 'group' ? 'Flat-share group' : 'Flatmate'),
        sub: v.sub || '',
        img: v.img || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80',
      };
    }).filter(Boolean);

    return shareCards;
  });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  const remove = (id) => {
    setRemoving((s) => new Set(s).add(id));
    setTimeout(() => {
      const card = allCards.find((c) => c.id === id);
      if (card && card.cat === 'share') {
        try {
          const savedMap = JSON.parse(localStorage.getItem(SHARE_KEY) || '{}');
          delete savedMap[id];
          localStorage.setItem(SHARE_KEY, JSON.stringify(savedMap));
        } catch (e) {}
      }
      // If it came from pnSavedProps store, also unsave there
      if (card && card.fromStore) {
        toggleSavedProp(id);
        setDynamicSaved((arr) => arr.filter((c) => c.id !== id));
      } else {
        setCards((arr) => arr.filter((c) => c.id !== id));
      }
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 400);
  };

  // Turn a saved property into an opt-in alert for similar listings (same intent,
  // locality and configuration, within a ±15% price band). Surfaces in Dashboard → Alerts.
  const createAlert = (c) => {
    const isRent = c.deal === 'rent';
    const lo = c.priceNum ? Math.round(c.priceNum * 0.85) : undefined;
    const hi = c.priceNum ? Math.round(c.priceNum * 1.15) : undefined;
    const f = {
      deal: isRent ? 'rent' : 'buy',
      types: [],
      bhk: c.bhkNum ? [String(c.bhkNum)] : [],
      localities: c.localitySlug ? [c.localitySlug] : [],
      budget: !isRent && lo ? [lo, hi] : undefined,
      rent: isRent && lo ? [lo, hi] : undefined,
    };
    addSavedSearch({ ...buildAlertRecord(f), query: '' });
    toast(tr('saved.alertToast'), 'success');
  };

  // Merge hardcoded + share + dynamically saved (from heart toggles)
  const allCards = useMemo(() => {
    const existingIds = new Set(cards.map((c) => c.id));
    const merged = [...cards, ...dynamicSaved.filter((d) => !existingIds.has(d.id))];
    return merged;
  }, [cards, dynamicSaved]);

  const counts = useMemo(() => {
    const m = {};
    CATEGORIES.forEach((c) => { m[c.key] = 0; });
    allCards.forEach((c) => { m[c.cat] = (m[c.cat] || 0) + 1; });
    return m;
  }, [allCards]);

  const activeCat = CATEGORIES.find((c) => c.key === tab) || CATEGORIES[0];
  const activeCatLabel = tr('saved.' + activeCat.labelKey, { defaultValue: activeCat.label });
  const activeCatDesc = tr('saved.' + activeCat.descKey, { defaultValue: activeCat.desc });
  const items = useMemo(() => {
    const filtered = allCards.filter((c) => c.cat === tab);
    return [...filtered].sort((a, b) => {
      if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
      const diff = (a.priceNum || 0) - (b.priceNum || 0);
      return sort === 'price-asc' ? diff : -diff;
    });
  }, [allCards, tab, sort]);

  return (
    <div className="saved-page">
      <main className="pt-5 sm:pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={'mb-6 sm:mb-10 fade-in' + (mounted ? ' visible' : '')}>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold mb-3">
              <Icon name="heart" className="w-3.5 h-3.5" /> {tr('saved.badge')}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{tr('saved.title')}</h1>
            {allCards.length > 0 && (
              <p className="text-gray-400 text-sm">
                {tr('saved.summaryPrefix')} <span className="text-teal-400 font-semibold">{allCards.length}</span>{' '}
                {tr('saved.summaryCount', { count: allCards.length })}
              </p>
            )}
          </div>

          {allCards.length > 0 ? (
            <>
              <div className={'saved-tabs flex items-center gap-2 overflow-x-auto no-scrollbar sm:flex-wrap sm:justify-center sm:gap-2.5 sm:overflow-visible mb-6 sm:mb-10 fade-in' + (mounted ? ' visible' : '')}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setTab(c.key)}
                    className={'saved-tab seg text-[13px] sm:text-sm font-semibold px-3.5 sm:px-5 py-2.5 rounded-xl text-gray-300 flex items-center gap-1.5 sm:gap-2 flex-shrink-0 whitespace-nowrap' + (tab === c.key ? ' active' : '')}
                  >
                    <Icon name={c.icon} className="w-4 h-4 flex-shrink-0" />
                    {c.shortKey ? (
                      <>
                        <span className="sm:hidden">{tr('saved.' + c.shortKey, { defaultValue: c.short })}</span>
                        <span className="hidden sm:inline">{tr('saved.' + c.labelKey, { defaultValue: c.label })}</span>
                      </>
                    ) : (
                      tr('saved.' + c.labelKey, { defaultValue: c.label })
                    )}
                    <span className="tab-count px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0">{counts[c.key]}</span>
                  </button>
                ))}
              </div>

              {items.length > 0 && (
                <div className={'flex items-center justify-end mb-6 fade-in' + (mounted ? ' visible' : '')}>
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Icon name="sliders-horizontal" className="w-4 h-4 text-teal-400" />
                    <span className="hidden sm:inline">{tr('saved.sortBy')}</span>
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-teal-400/50"
                    >
                      {SORTS.map(([v, label, tk]) => <option key={v} value={v} className="bg-[#0f0d1a]">{tr('saved.' + tk, { defaultValue: label })}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {items.length > 0 ? (
                <div key={tab} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                  {items.map((c, i) => (
                    <div
                      key={c.id}
                      className={
                        'property-card rounded-2xl overflow-hidden fade-in' +
                        (mounted ? ' visible' : '') +
                        (removing.has(c.id) ? ' removing' : '') +
                        ` fade-in-delay-${(i % 3) + 1}`
                      }
                    >
                      <Link to={`/property/${c.id}`} className="block">
                        <div className="card-image relative h-44 sm:h-56">
                          <img src={c.img} alt={c.title} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                          <div className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-black/30 backdrop-blur-md flex items-center justify-center"><Icon name="heart" className="w-5 h-5 text-red-400 fill-red-400" /></div>
                          <div className="absolute top-4 left-4"><span className="type-badge px-3 py-1.5 rounded-full text-xs font-semibold text-teal-300 backdrop-blur-md">{c.badge}</span></div>
                          <div className="absolute bottom-4 left-4"><p className="text-2xl font-bold text-white">{c.price}</p></div>
                        </div>
                      </Link>
                      <div className="p-5">
                        <Link to={`/property/${c.id}`} className="block mb-3">
                          <h3 className="text-lg font-bold text-white mb-1 hover:text-teal-400 transition-colors">{c.title}</h3>
                          <div className="flex items-center gap-1.5 text-gray-400 text-sm"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {c.loc}</div>
                        </Link>
                        {c.cat !== 'share' && (
                          <div className="flex items-center gap-2 mb-3 text-sm">
                            <span className="font-semibold text-white">{c.price}</span>
                            <span className="text-gray-600">·</span>
                            <span className="inline-flex items-center gap-1 text-teal-400 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-teal-400" />{c.statusLabel || tr('saved.available')}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-white/5">
                          {c.cat === 'share' ? (
                            <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name={c.kind === 'group' ? 'users-round' : 'user'} className="w-3.5 h-3.5" /> {c.sub}</div>
                          ) : (
                            <>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="bed-double" className="w-3.5 h-3.5" /> {c.bhk}</div>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="maximize" className="w-3.5 h-3.5" /> {c.area}</div>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="bath" className="w-3.5 h-3.5" /> {c.bath}</div>
                            </>
                          )}
                        </div>
                        {c.cat !== 'share' ? (
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/contact?ref=${encodeURIComponent(c.id)}&subject=${encodeURIComponent(c.cat === 'rent' ? 'Renting this property' : 'Buying this property')}`}
                              className="btn-teal flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"
                            >
                              <Icon name="mail" className="w-4 h-4" /> {tr('saved.contact')}
                            </Link>
                            <button onClick={() => createAlert(c)} title={tr('saved.createAlertAria')} aria-label={tr('saved.createAlertAria')} className="w-11 h-11 shrink-0 rounded-xl border border-white/10 text-gray-300 hover:text-teal-300 hover:border-teal-400/40 flex items-center justify-center transition-colors">
                              <Icon name="bell-plus" className="w-4 h-4" />
                            </button>
                            <button onClick={() => remove(c.id)} title={tr('saved.removeFromSaved')} aria-label={tr('saved.removeFromSaved')} className="remove-btn w-11 h-11 shrink-0 rounded-xl border border-white/10 text-gray-400 flex items-center justify-center">
                              <Icon name="trash-2" className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => remove(c.id)} className="remove-btn w-full py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium flex items-center justify-center gap-2"><Icon name="trash-2" className="w-4 h-4" /> {tr('saved.removeBtn')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5"><Icon name={activeCat.icon} className="w-9 h-9 text-gray-600" /></div>
                  <h2 className="text-xl font-bold text-white mb-2">{tr('saved.emptyCatTitle', { cat: activeCatLabel.toLowerCase() })}</h2>
                  <p className="text-gray-500 mb-7 max-w-md mx-auto">{tr('saved.emptyCatBody', { desc: activeCatDesc.toLowerCase() })}</p>
                  <Link to="/listings" className="btn-teal inline-flex items-center gap-2 px-7 py-3 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20"><Icon name="search" className="w-4 h-4" /> {tr('saved.browseProperties')}</Link>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state text-center py-24">
              <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6 heart-pulse"><Icon name="heart" className="w-10 h-10 text-gray-600" /></div>
              <h2 className="text-2xl font-bold text-white mb-3">{tr('saved.emptyTitle')}</h2>
              <p className="text-gray-500 text-lg mb-8 max-w-md mx-auto">{tr('saved.emptyBody')}</p>
              <Link to="/listings" className="btn-teal inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20"><Icon name="search" className="w-4 h-4" /> {tr('saved.browseProperties')}</Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
