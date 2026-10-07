import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import PropertyImage from '../../components/ui/PropertyImage.jsx';
import { CARD_SIZES } from '../../lib/imgSrcSet.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { fmtINR } from '../../lib/format.js';
import usePullToRefresh from '../../lib/usePullToRefresh.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import { toSavedCard } from './flatmates/helpers.js';
import * as flatmateService from '../../services/flatmateService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { ActionSheet, AlertsRow, SkeletonRows, SwipeCard, UndoRow } from './saved/SavedPageParts.jsx';
import '../../styles/routes/saved.css';

const CATEGORIES = [
  { key: 'all', label: 'All', labelKey: 'catAllLabel', icon: 'heart' },
  { key: 'buy', label: 'Buy', labelKey: 'catBuyLabel', icon: 'home' },
  { key: 'rent', label: 'Rent', labelKey: 'catRentLabel', icon: 'key' },
  { key: 'flatmates', label: 'Rooms', labelKey: 'catRoomsLabel', icon: 'users-round' },
];

const SORTS = [['newest', 'Newest', 'sortNewest'], ['price-desc', 'Price: High to Low', 'sortPriceHigh'], ['price-asc', 'Price: Low to High', 'sortPriceLow']];
const UNDO_WINDOW_MS = 8000;

/* How long a swiped-away card stays undoable before the removal commits. */
const isUnavailable = (status) => status && !['active', 'approved', 'live'].includes(String(status).toLowerCase());
/* The flatmate half of the shortlist. */

async function readFlatmateSaves() {
  const page = await flatmateService.listFlatmateSaves();
  return (page?.items || []).map(toSavedCard).filter(Boolean);
}
/* Focus moves onto Undo because the control that caused the removal unmounts with the card — focus would otherwise
   fall to `<body>`, far from an escape hatch that expires in five seconds. */

export default function Saved() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();
  const { isIn } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('newest');
  const [removing, setRemoving] = useState(() => new Set());
  /* Ids removed but not yet committed — they render as an undo row instead of a card. */
  const [pendingRemoval, setPendingRemoval] = useState(() => new Map());
  const [alerting, setAlerting] = useState(() => new Set());
  const [actionCard, setActionCard] = useState(null);
  const undoTimers = useRef(new Map());
  const pendingRef = useRef(new Map());
  const commitRef = useRef(() => {});

  const savedList = useSaved();
  const savedSearches = useSavedSearches();
  /* The shared shortlist already holds the rows, so this is a pure reshape — hence useMemo, not an effect with its
     own fetch, which would cost a request per card. */

  const dynamicSaved = useMemo(() => savedList.items.map((p) => {
    const isRent = p.deal === 'rent';
    const locality = p.locality || 'Pune';
    return {
      id: p.id,
      // `remove()` below addresses `DELETE /me/saved/{propId}` with the row's primary key, not the
      // routing token.
      uuid: p.uuid,
      cat: isRent ? 'rent' : 'buy',
      title: p.title || p.type || 'Property',
      loc: locality,
      price: typeof p.price === 'number' ? (isRent ? `₹${p.price.toLocaleString('en-IN')}/mo` : fmtINR(p.price)) : (p.price || ''),
      priceNum: typeof p.price === 'number' ? p.price : 0,
      createdAt: p.createdAt || 0,
      unavailable: isUnavailable(p.status),
      deal: isRent ? 'rent' : 'buy',
      localitySlug: p.locality || '',
      bhkNum: p.bhkNum || null,
      badge: isRent ? 'For Rent' : 'For Sale',
      bhk: p.bhk || (p.bhkNum ? `${p.bhkNum} BHK` : ''),
      area: p.area ? `${p.area.toLocaleString('en-IN')} sq.ft.` : '',
      bath: p.bath ? `${p.bath} Bath` : '',
      img: p.image || p.img || null,
      fromStore: true,
    };
  }), [savedList.items]);

  /* Load the flatmate half once per identity. */
  const [cards, setCards] = useState([]);
  const loadFlatmateSaves = useCallback(
    () => readFlatmateSaves()
      .then((rows) => { setCards(rows); return rows; })
      .catch((e) => { console.warn('[saved] flatmate saves failed', e); setCards([]); return []; }),
    [],
  );
  useEffect(() => { loadFlatmateSaves(); }, [loadFlatmateSaves, isIn]);

  /* Re-reads both halves: refreshing only one would leave the gesture looking like it half worked on a page that
     shows the two interleaved. */
  const refreshShortlist = savedList.reload || savedList.refresh;
  const ptr = usePullToRefresh(useCallback(
    () => Promise.resolve(refreshShortlist()).catch(() => {}).then(loadFlatmateSaves),
    [refreshShortlist, loadFlatmateSaves],
  ));

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

        /* Drop it locally first so the card leaves with the animation, then tell the server. */
      // If it came from the property shortlist, unsave it there — `dynamicSaved` is derived from the
      // context, so the card disappears when that write lands rather than from a second local list.
  const commitRemoval = useCallback((card, { animate = true } = {}) => {
    if (!card) return;
    if (!animate) {
      void (async () => {
        let ok = true;
        if (card.fromStore) ok = await savedList.unsave(card.id, card.uuid);
        else if (card.cat === 'flatmates') {
          try {
            await flatmateService.unsaveFlatmatePost(card.saveKind, String(card.id).slice(2));
          } catch (e) {
            ok = false;
            console.warn('[saved] flatmate unsave failed', e);
          }
        }
        if (!ok) toast(tr('saved.updateFailed'), 'error');
      })();
      return;
    }
    const finish = async () => {
      let ok = true;
      if (card.fromStore) ok = await savedList.unsave(card.id, card.uuid);
      else if (card.cat === 'flatmates') {
        setCards((arr) => arr.filter((c) => c.id !== card.id));
        try {
          await flatmateService.unsaveFlatmatePost(card.saveKind, String(card.id).slice(2));
        } catch (e) {
          ok = false;
          console.warn('[saved] flatmate unsave failed', e);
          setCards((arr) => (arr.some((c) => c.id === card.id) ? arr : [card, ...arr]));
        }
      } else {
        setCards((arr) => arr.filter((c) => c.id !== card.id));
      }
      if (!ok) toast(tr('saved.updateFailed'), 'error');
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(card.id);
        return next;
      });
    };
    setRemoving((s) => new Set(s).add(card.id));
    setTimeout(finish, 400);
  }, [savedList, toast, tr]);

  useEffect(() => { commitRef.current = commitRemoval; }, [commitRemoval]);

  /* Stage the card as undoable, then commit on a timer. Shared by the swipe and by the per-card remove buttons. */
  const stageRemove = useCallback((card) => {
    if (!card || pendingRef.current.has(card.id)) return;
    const next = new Map(pendingRef.current);
    next.set(card.id, card);
    pendingRef.current = next;
    setPendingRemoval(next);
    const timer = setTimeout(() => {
      undoTimers.current.delete(card.id);
      const remaining = new Map(pendingRef.current);
      remaining.delete(card.id);
      pendingRef.current = remaining;
      setPendingRemoval(remaining);
      commitRemoval(card);
    }, UNDO_WINDOW_MS);
    undoTimers.current.set(card.id, timer);
  }, [commitRemoval]);

  const undoRemove = (id) => {
    clearTimeout(undoTimers.current.get(id));
    undoTimers.current.delete(id);
    const next = new Map(pendingRef.current);
    next.delete(id);
    pendingRef.current = next;
    setPendingRemoval(next);
  };
  // A pending commit timer would remove a card the user cannot see, let alone undo.

  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      pendingRef.current.forEach((card) => commitRef.current(card, { animate: false }));
      pendingRef.current = new Map();
    };
  }, []);

  // Turn a saved property into an opt-in alert for similar listings (same intent,
  // locality and configuration, within a ±15% price band). Surfaces in Dashboard → Alerts.
  const createAlert = async (c) => {
    if (alerting.has(c.id)) return;
    setAlerting((s) => new Set(s).add(c.id));
    try {
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
      await savedSearches.create({ ...buildAlertRecord(f), query: '' });
      toast(tr('saved.alertToast'), 'success');
      setActionCard(null);
    } catch {
      toast(tr('saved.alertFailed'), 'error');
    } finally {
      setAlerting((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
    }
  };

  const allCards = useMemo(() => {
    const existingIds = new Set(cards.map((c) => c.id));
    return [...cards, ...dynamicSaved.filter((d) => !existingIds.has(d.id))];
  }, [cards, dynamicSaved]);

  const counts = useMemo(() => {
    const m = { all: allCards.length, buy: 0, rent: 0, flatmates: 0 };
    allCards.forEach((c) => { m[c.cat] = (m[c.cat] || 0) + 1; });
    return m;
  }, [allCards]);
  /* Shared by the pill strip, the bottom-sheet switcher and the per-category empty state, so the three can never
     drift apart on a rename. */

  const catLabel = useCallback((c) => (c ? tr('saved.' + c.labelKey, { defaultValue: c.label }) : ''), [tr]);
  const items = useMemo(() => {
    const filtered = tab === 'all' ? allCards : allCards.filter((c) => c.cat === tab);
    return [...filtered].sort((a, b) => {
      if (sort === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
      const diff = (a.priceNum || 0) - (b.priceNum || 0);
      return sort === 'price-asc' ? diff : -diff;
    });
  }, [allCards, tab, sort]);

  const summaryParts = useMemo(() => {
    const homes = counts.buy + counts.rent;
    const rooms = counts.flatmates;
    return [
      homes ? tr('saved.homeCount', { count: homes }) : '',
      rooms ? tr('saved.roomCount', { count: rooms }) : '',
    ].filter(Boolean).join(' · ');
  }, [counts.buy, counts.rent, counts.flatmates, tr]);

  const isLoading = savedList.status === 'loading';
  const isError = savedList.status === 'error';

  return (
    <div ref={ptr.ref} className="saved-page">
      {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
        <div
          aria-hidden="true"
          data-testid="ptr-indicator"
          className="glass-strong pointer-events-none fixed left-1/2 z-40 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
          style={{ top: `calc(var(--dz-nav-h) + ${Math.round(ptr.pullDistance)}px)`, opacity: 0.4 + ptr.progress * 0.6 }}
        >
          <Icon name={ptr.isRefreshing ? 'loader-2' : 'chevron-down'} className={'w-4 h-4 text-teal-400' + (ptr.isRefreshing ? ' animate-spin' : '')} style={ptr.isRefreshing ? undefined : { transform: `rotate(${ptr.progress * 180}deg)` }} />
        </div>
      )}
      <div className="pt-5 sm:pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={'mb-5 sm:mb-8 fade-in' + (mounted ? ' visible' : '')}>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold mb-3">
              <Icon name="heart" className="w-3.5 h-3.5" /> {tr('saved.badge')}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{tr('saved.title')}</h1>
            {summaryParts && <p className="text-gray-400 text-sm"><span className="text-teal-400 font-semibold">{summaryParts}</span></p>}
          </div>
          {/* Signed-out shortlists are real — Reels, Compare and the map detail panel all write dzSavedProps while
             logged out. */}

          {!isIn && (
            <div className={'mb-5 flex flex-col gap-3 rounded-2xl border border-teal-400/20 bg-teal-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between fade-in' + (mounted ? ' visible' : '')}>
              <div className="flex items-start gap-3 min-w-0">
                <Icon name="cloud-off" className="w-5 h-5 flex-shrink-0 text-teal-300 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{tr('saved.guestTitle')}</p>
                  <p className="text-[13px] text-gray-400">{tr('saved.guestBody')}</p>
                </div>
              </div>
              <Link to="/signin?reason=saved&next=%2Fsaved" className="btn-teal shrink-0 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold">
                <Icon name="log-in" className="w-4 h-4" /> {tr('saved.guestCta')}
              </Link>
            </div>
          )}

          {isLoading ? (
            <SkeletonRows />
          ) : isError ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-center">
              <p className="text-sm font-semibold text-white">{tr('saved.loadError')}</p>
              <button type="button" onClick={() => { void savedList.reload().catch(() => {}); }} className="mt-4 min-h-[44px] rounded-xl border border-white/10 px-5 text-sm font-semibold text-teal-200">
                {tr('saved.retry')}
              </button>
            </div>
          ) : allCards.length > 0 ? (
            <>
              {/* Three pills across a 360px viewport truncate their own labels and leave no room for the
                 descriptions, so phones get a bottom sheet instead. */}
              <div className={'saved-tabs mb-4 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1 fade-in' + (mounted ? ' visible' : '')}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setTab(c.key)}
                    aria-pressed={tab === c.key}
                    className={'saved-tab seg min-h-[44px] flex-1 rounded-xl px-2 py-2 text-center text-xs font-semibold text-gray-300 sm:text-sm' + (tab === c.key ? ' active' : '')}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                      <Icon name={c.icon} className="h-3.5 w-3.5 flex-shrink-0 max-[389px]:hidden" />
                      <span>{catLabel(c)}</span>
                      <span className="tab-count rounded-full px-1.5 py-0.5 text-[10px]">{counts[c.key]}</span>
                    </span>
                  </button>
                ))}
              </div>

              <AlertsRow searches={savedSearches.searches} status={savedSearches.status} isIn={isIn} />

              {items.length > 0 && (
                <div className={'flex items-center justify-end mb-4 sm:mb-6 fade-in' + (mounted ? ' visible' : '')}>
                  <label className="flex items-center gap-2 text-sm text-gray-400">
                    <Icon name="sliders-horizontal" className="w-4 h-4 text-teal-400" />
                    <span className="hidden sm:inline">{tr('saved.sortBy')}</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-teal-400/50">
                      {SORTS.map(([v, label, tk]) => <option key={v} value={v} className="bg-ink">{tr('saved.' + tk, { defaultValue: label })}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {items.length > 0 ? (
                  /* The gesture is invisible until someone tries it, so say it once. */
                <div key={tab} className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-6 lg:grid-cols-3 lg:gap-8">
                  {items.map((c, i) => (pendingRemoval.has(c.id) ? (
                    <UndoRow key={c.id} label={tr('saved.removedTitle', { title: c.title })} undoLabel={tr('saved.undo')} undoAria={tr('saved.undoAria', { title: c.title })} onUndo={() => undoRemove(c.id)} />
                  ) : (
                    <SwipeCard
                      key={c.id}
                      card={c}
                      onRemove={() => stageRemove(c)}
                      onAction={setActionCard}
                      className={'property-card rounded-2xl overflow-hidden fade-in' + (mounted ? ' visible' : '') + (removing.has(c.id) ? ' removing' : '') + ` fade-in-delay-${(i % 3) + 1}`}
                    >
                      <div className="flex min-h-[96px] items-center gap-3 p-2 md:block md:min-h-0 md:p-0">
                        <Link to={c.cat === 'flatmates' ? '/flatmates' : `/property/${c.id}`} className="saved-row-link flex min-w-0 flex-1 items-center gap-3 md:block">
                          <div className="card-image relative h-[88px] w-[88px] flex-shrink-0 rounded-xl md:h-56 md:w-full md:rounded-none">
                            <PropertyImage src={c.img} sizes={`(max-width: 767px) 88px, ${CARD_SIZES}`} alt={c.title} className="w-full h-full object-cover" />
                            <div className="hidden md:block absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                            <div className="hidden md:block absolute top-4 left-4"><span className="type-badge px-3 py-1.5 rounded-full text-xs font-semibold text-teal-300 backdrop-blur-md">{c.badge}</span></div>
                            <div className="hidden md:block absolute bottom-4 left-4"><p className="text-2xl font-bold text-white">{c.price}</p></div>
                          </div>
                          <div className="min-w-0 flex-1 md:p-5">
                            <div className="flex items-start gap-2 md:block">
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-bold text-white md:text-lg">{c.price}</p>
                                <h3 className="truncate text-sm font-semibold text-white md:mt-2 md:text-lg">{c.title}</h3>
                                <p className="mt-0.5 truncate text-xs text-gray-400 md:text-sm">{c.cat === 'flatmates' ? c.sub : [c.bhk, c.loc].filter(Boolean).join(' · ')}</p>
                              </div>
                              {c.unavailable && <span className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-200">{tr('saved.noLongerAvailable')}</span>}
                            </div>
                          </div>
                        </Link>
                        <div className="hidden md:mx-5 md:mb-5 md:flex md:items-center md:gap-3 md:border-t md:border-white/5 md:pt-4">
                          {c.cat !== 'flatmates' ? (
                            <>
                              <span className="text-xs text-gray-400">{[c.bhk, c.area, c.bath].filter(Boolean).join(' · ')}</span>
                              <span className="ml-auto flex items-center gap-2">
                                <button type="button" disabled={alerting.has(c.id)} onClick={() => { void createAlert(c); }} title={tr('saved.createAlertAria')} aria-label={tr('saved.createAlertAria')} className="w-11 h-11 shrink-0 rounded-xl border border-white/10 text-gray-300 flex items-center justify-center transition-colors disabled:opacity-60">
                                  <Icon name={alerting.has(c.id) ? 'loader-2' : 'bell-plus'} className={'w-4 h-4' + (alerting.has(c.id) ? ' animate-spin' : '')} />
                                </button>
                                <button type="button" onClick={() => stageRemove(c)} title={tr('saved.removeFromSaved')} aria-label={tr('saved.removeFromSaved')} className="remove-btn w-11 h-11 shrink-0 rounded-xl border border-white/10 text-red-300 flex items-center justify-center">
                                  <Icon name="heart" weight="fill" className="w-4 h-4" />
                                </button>
                              </span>
                            </>
                          ) : (
                            <button type="button" onClick={() => stageRemove(c)} className="remove-btn w-full min-h-[44px] py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium flex items-center justify-center gap-2">
                              <Icon name="trash-2" className="w-4 h-4" /> {tr('saved.removeBtn')}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 md:hidden">
                          <button type="button" onClick={() => setActionCard(c)} aria-label={tr('saved.moreActions')} className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-white/10 text-xl leading-none text-gray-300">
                            ⋯
                          </button>
                          <button type="button" onClick={() => stageRemove(c)} title={tr('saved.removeFromSaved')} aria-label={tr('saved.removeFromSaved')} className="remove-btn grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-white/10 text-red-300">
                            <Icon name="heart" weight="fill" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </SwipeCard>
                  )))}
                </div>
              ) : (
                <div className="text-center py-20">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5"><Icon name="heart" className="w-9 h-9 text-gray-600" /></div>
                  <h2 className="text-xl font-bold text-white mb-2">{tr('saved.emptyCatTitle', { cat: catLabel(CATEGORIES.find((c) => c.key === tab)).toLowerCase() })}</h2>
                  <p className="text-gray-500 mb-7 max-w-md mx-auto">{tr('saved.emptyCatBody')}</p>
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
      <ActionSheet
        card={actionCard}
        onClose={() => setActionCard(null)}
        onAlert={(card) => { void createAlert(card); }}
        onRemove={(card) => { setActionCard(null); stageRemove(card); }}
        alerting={actionCard ? alerting.has(actionCard.id) : false}
        createAlertLabel={tr('saved.createAlertAria')}
        removeLabel={tr('saved.removeBtn')}
        closeLabel={tr('saved.closeActions', { defaultValue: 'Close saved actions' })}
      />
    </div>
  );
}
