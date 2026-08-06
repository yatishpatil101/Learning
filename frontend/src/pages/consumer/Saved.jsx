import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useSaved } from '../../context/SavedContext.jsx';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { fmtINR } from '../../lib/format.js';
import useSwipeDismiss from '../../lib/useSwipeDismiss.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import '../../styles/routes/saved.css';

const FLATMATE_SAVED_KEY = 'puneNestFlatmateSaved';

const CATEGORIES = [
  { key: 'buy', label: 'For Sale', labelKey: 'catBuyLabel', icon: 'home', desc: 'Properties you want to buy', descKey: 'catBuyDesc' },
  { key: 'rent', label: 'For Rent', labelKey: 'catRentLabel', icon: 'key', desc: 'Rentals you shortlisted', descKey: 'catRentDesc' },
  { key: 'flatmates', label: 'Flatmates & Rooms', labelKey: 'catFlatmatesLabel', shortKey: 'catFlatmatesShort', short: 'Flatmates', icon: 'users-round', desc: 'Shared living saves', descKey: 'catFlatmatesDesc' },
];

const SORTS = [['newest', 'Newest', 'sortNewest'], ['price-desc', 'Price: High to Low', 'sortPriceHigh'], ['price-asc', 'Price: Low to High', 'sortPriceLow']];

/* How long a swiped-away card stays undoable before the removal commits. */
const UNDO_WINDOW_MS = 5000;

const statusLabelFor = (status) => {
  if (!status || status === 'active') return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

/* Arms swipe-left-to-remove on one saved card. A component rather than an inline
   hook call because hooks can't run inside a .map(). The gesture itself is
   mobile-only (useSwipeDismiss never arms above 640px), and `pan-y` keeps the
   page's vertical scroll with the browser while we claim the horizontal axis. */
function SwipeCard({ onRemove, className, children }) {
  const swipe = useSwipeDismiss(onRemove, { axis: 'x' });
  return (
    <div {...swipe} className={className} style={{ touchAction: 'pan-y' }}>
      {children}
    </div>
  );
}

export default function Saved() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();
  const { isIn } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState('buy');
  const [sort, setSort] = useState('newest');
  const [removing, setRemoving] = useState(() => new Set());
  /* Ids swiped away but not yet committed — they render as an undo row instead of
     a card. A swipe is easy to fire by accident on a list the user curated by
     hand, so removal is always reversible for a few seconds. */
  const [pendingRemoval, setPendingRemoval] = useState(() => new Set());
  const undoTimers = useRef(new Map());

  const savedList = useSaved();
  const { create: createSavedSearch } = useSavedSearches();

  /* Saved properties come from the shared shortlist, which already holds the rows: the page used to
     read a list of ids and then fetch each property, so a shortlist of thirty cost thirty-one
     requests to render. This is a pure reshape of rows already in hand — hence useMemo, not an
     effect with its own fetch. Flatmate saves are a separate localStorage feature and still load
     below; only the property half moved. */
  const dynamicSaved = useMemo(() => savedList.items.map((p) => {
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
  }), [savedList.items]);

  const [cards, setCards] = useState(() => {
    const savedMap = {};
    try {
      const stored = localStorage.getItem(FLATMATE_SAVED_KEY);
      if (stored) Object.assign(savedMap, JSON.parse(stored));
    } catch (e) {}

    const flatmateCards = Object.keys(savedMap).map((k) => {
      const v = savedMap[k];
      if (!v || typeof v !== 'object') return null;
      return {
        id: k,
        cat: 'flatmates',
        kind: v.kind || 'flatmate',
        title: v.title || 'Saved item',
        loc: v.loc || 'Pune',
        price: v.price || '',
        badge: v.badge || (v.kind === 'group' ? 'Flatmate group' : 'Flatmate'),
        sub: v.sub || '',
        img: v.img || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80',
      };
    }).filter(Boolean);

    return flatmateCards;
  });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  const remove = (id) => {
    setRemoving((s) => new Set(s).add(id));
    setTimeout(() => {
      const card = allCards.find((c) => c.id === id);
      if (card && card.cat === 'flatmates') {
        try {
          const savedMap = JSON.parse(localStorage.getItem(FLATMATE_SAVED_KEY) || '{}');
          delete savedMap[id];
          localStorage.setItem(FLATMATE_SAVED_KEY, JSON.stringify(savedMap));
        } catch (e) {}
      }
      // If it came from the shortlist, unsave it there — `dynamicSaved` is derived from the
      // context, so the card disappears when that write lands rather than from a second local list.
      if (card && card.fromStore) {
        savedList.toggle(id);
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

  /* Swipe-left removal: stage the card as undoable, then commit on a timer. */
  const swipeRemove = (id) => {
    if (pendingRemoval.has(id)) return;
    setPendingRemoval((s) => new Set(s).add(id));
    const timer = setTimeout(() => {
      undoTimers.current.delete(id);
      setPendingRemoval((s) => { const next = new Set(s); next.delete(id); return next; });
      remove(id);
    }, UNDO_WINDOW_MS);
    undoTimers.current.set(id, timer);
  };

  const undoRemove = (id) => {
    clearTimeout(undoTimers.current.get(id));
    undoTimers.current.delete(id);
    setPendingRemoval((s) => { const next = new Set(s); next.delete(id); return next; });
  };

  // Never leave a commit timer running after the page unmounts — it would remove a
  // card the user can no longer see, let alone undo.
  useEffect(() => {
    const timers = undoTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

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
    createSavedSearch({ ...buildAlertRecord(f), query: '' });
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
      <div className="pt-5 sm:pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
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

          {/* Signed-out shortlists are real: Reels, Compare and the map detail panel
              all write pnSavedProps while logged out, and Saved is a permanent bottom-nav
              tab. Show what's on the device and explain the ceiling, rather than bouncing
              the user to a login wall they never asked for. */}
          {!isIn && (
            <div className={'mb-6 sm:mb-8 flex flex-col gap-3 rounded-2xl border border-teal-400/20 bg-teal-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between fade-in' + (mounted ? ' visible' : '')}>
              <div className="flex items-start gap-3 min-w-0">
                <Icon name="cloud-off" className="w-5 h-5 flex-shrink-0 text-teal-300 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{tr('saved.guestTitle')}</p>
                  <p className="text-[13px] text-gray-400">{tr('saved.guestBody')}</p>
                </div>
              </div>
              <Link
                to="/signin?reason=saved&next=%2Fsaved"
                className="btn-teal shrink-0 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold"
              >
                <Icon name="log-in" className="w-4 h-4" /> {tr('saved.guestCta')}
              </Link>
            </div>
          )}

          {allCards.length > 0 ? (
            <>
              {/* Three tabs behind a horizontal scroll meant the third was often
                  off-screen with no affordance that it existed. With only three
                  categories a 3-up grid shows all of them at once on a phone; the
                  sm: branch restores today's centred wrap for tablet and desktop. */}
              <div className={'saved-tabs grid grid-cols-3 gap-2 sm:flex sm:items-center sm:flex-wrap sm:justify-center sm:gap-2.5 mb-6 sm:mb-10 fade-in' + (mounted ? ' visible' : '')}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setTab(c.key)}
                    aria-pressed={tab === c.key}
                    className={'saved-tab seg text-[13px] sm:text-sm font-semibold min-h-[44px] px-2 sm:px-5 py-2.5 rounded-xl text-gray-300 flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 sm:flex-shrink-0 whitespace-nowrap min-w-0' + (tab === c.key ? ' active' : '')}
                  >
                    <Icon name={c.icon} className="w-4 h-4 flex-shrink-0" />
                    {c.shortKey ? (
                      <>
                        <span className="sm:hidden truncate">{tr('saved.' + c.shortKey, { defaultValue: c.short })}</span>
                        <span className="hidden sm:inline">{tr('saved.' + c.labelKey, { defaultValue: c.label })}</span>
                      </>
                    ) : (
                      <span className="truncate">{tr('saved.' + c.labelKey, { defaultValue: c.label })}</span>
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
                <>
                  {/* The gesture is invisible until someone tries it, so say it once.
                      Phone-only: there is no swipe on a desktop pointer. */}
                  <p className="sm:hidden -mt-2 mb-3 flex items-center gap-1.5 text-[12px] text-gray-500">
                    <Icon name="chevron-left" className="w-3.5 h-3.5" /> {tr('saved.swipeToRemove')}
                  </p>
                  <div key={tab} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                  {items.map((c, i) => (pendingRemoval.has(c.id) ? (
                    <div key={c.id} className="property-card rounded-2xl overflow-hidden flex items-center justify-between gap-3 p-4">
                      <span className="flex items-center gap-2 min-w-0 text-sm text-gray-300">
                        <Icon name="trash-2" className="w-4 h-4 flex-shrink-0 text-gray-500" />
                        <span className="truncate">{tr('saved.removedTitle', { title: c.title })}</span>
                      </span>
                      <button
                        onClick={() => undoRemove(c.id)}
                        className="shrink-0 min-h-[44px] px-4 rounded-xl border border-white/10 text-teal-300 text-sm font-semibold hover:border-teal-400/40 hover:bg-white/5 transition-colors"
                      >
                        {tr('saved.undo')}
                      </button>
                    </div>
                  ) : (
                    <SwipeCard
                      key={c.id}
                      onRemove={() => swipeRemove(c.id)}
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
                          <div className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-black/30 backdrop-blur-md flex items-center justify-center"><Icon name="heart" weight="fill" className="w-5 h-5 text-red-400" /></div>
                          <div className="absolute top-4 left-4"><span className="type-badge px-3 py-1.5 rounded-full text-xs font-semibold text-teal-300 backdrop-blur-md">{c.badge}</span></div>
                          <div className="absolute bottom-4 left-4"><p className="text-2xl font-bold text-white">{c.price}</p></div>
                        </div>
                      </Link>
                      <div className="p-5">
                        <Link to={`/property/${c.id}`} className="block mb-3">
                          <h3 className="text-lg font-bold text-white mb-1 hover:text-teal-400 transition-colors">{c.title}</h3>
                          <div className="flex items-center gap-1.5 text-gray-400 text-sm"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {c.loc}</div>
                        </Link>
                        {c.cat !== 'flatmates' && (
                          <div className="flex items-center gap-2 mb-3 text-sm">
                            <span className="font-semibold text-white">{c.price}</span>
                            <span className="text-gray-600">·</span>
                            <span className="inline-flex items-center gap-1 text-teal-400 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-teal-400" />{c.statusLabel || tr('saved.available')}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-white/5">
                          {c.cat === 'flatmates' ? (
                            <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name={c.kind === 'group' ? 'users-round' : 'user'} className="w-3.5 h-3.5" /> {c.sub}</div>
                          ) : (
                            <>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="bed-double" className="w-3.5 h-3.5" /> {c.bhk}</div>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="maximize" className="w-3.5 h-3.5" /> {c.area}</div>
                              <div className="flex items-center gap-1.5 text-gray-400 text-xs"><Icon name="bath" className="w-3.5 h-3.5" /> {c.bath}</div>
                            </>
                          )}
                        </div>
                        {c.cat !== 'flatmates' ? (
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
                          <button onClick={() => remove(c.id)} className="remove-btn w-full min-h-[44px] py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium flex items-center justify-center gap-2"><Icon name="trash-2" className="w-4 h-4" /> {tr('saved.removeBtn')}</button>
                        )}
                      </div>
                    </SwipeCard>
                  )))}
                  </div>
                </>
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
      </div>
    </div>
  );
}
