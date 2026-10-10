import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import '../../styles/routes/reels.css';
import { fmtINR, rentLabel } from '../../lib/format.js';
import { propertyReels } from '../../services/propertyService.js';
import { RESIDENTIAL_KEYS } from '../../data/propertyTypes.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
/* The feed is the live catalogue, not a curated list — a hardcoded set means a newly posted home can never appear
   here and its caption can drift from the listing it links to. */

const MIN_PHOTOS = 3;
/* `flatmates` keeps shared rooms in the feed: the server's building keys alone exclude any share-type listing. */
const REEL_QUERY = { types: [...RESIDENTIAL_KEYS, 'flatmates'], minPhotos: MIN_PHOTOS };

const toReel = (p) => ({
  /* Carried alongside `id` because they are different strings and the save needs the other one. */
  id: p.slug || p.id,
  uuid: p.id,
  photos: p.photos || [],
  title: p.title,
  loc: p.locality,
  deal: p.deal,
  price: p.price,
  bhk: p.bhk ?? null,
  area: p.area,
});

const FILTERS = [
  { key: 'all', labelKey: 'reels.filterAll', icon: 'sparkles' },
  { key: 'rent', labelKey: 'reels.filterRent', icon: 'key' },
  { key: 'buy', labelKey: 'reels.filterBuy', icon: 'home' },
];

const TOUR_MS = 7000;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const compact = (n) => {
  const num = Number(n) || 0;
  if (num >= 100000) return (num / 100000).toFixed(num % 100000 === 0 ? 0 : 1) + 'L';
  if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'K';
  return String(num);
};
const priceLabel = (r) => (r.deal === 'rent' ? rentLabel(r.price) : fmtINR(r.price));

export default function Reels() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reduced, setReduced] = useState(prefersReducedMotion);

  const [filter, setFilter] = useState('all');
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    let alive = true;
    propertyReels(REEL_QUERY).then((rows) => {
      if (!alive) return;
      setFeed(rows.map(toReel));
      // `feed` stays null forever on a rejection, and null is the loading state — so a failed catalogue read renders
      // "loading" indefinitely.
    }).catch(() => {
      if (alive) setFeed([]);
    });
    return () => { alive = false; };
  }, []);

  const reels = useMemo(() => {
    const list = feed || [];
    return filter === 'all' ? list : list.filter((r) => r.deal === filter);
  }, [feed, filter]);
  /* Liked is session-only and intentionally uncounted. */

  const [liked, setLiked] = useState(() => new Set());
  // The context exposes the same `has(id)` the local Set did, so the markup below is unchanged.
  const saved = useSaved();
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(!prefersReducedMotion());
  const [burst, setBurst] = useState(null);
  const [photoIdx, setPhotoIdx] = useState({});

  const wrapRef = useRef(null);
  const reelRefs = useRef({});
  const tapRef = useRef({ time: 0, id: null, t: null });
  const activeRef = useRef(0);
  const burstSeq = useRef(0);
  activeRef.current = active;

  const setReelRef = useCallback((id) => (el) => {
    if (el) reelRefs.current[id] = el; else delete reelRefs.current[id];
  }, []);
  // React to OS "reduce motion" changes mid-session.

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // Clear any pending single-tap timer on unmount.

  useEffect(() => () => { if (tapRef.current.t) clearTimeout(tapRef.current.t); }, []);
  // Track which reel is in view via IntersectionObserver.

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const idx = Number(e.target.dataset.idx);
            if (!Number.isNaN(idx)) setActive(idx);
          }
        });
      },
      { root, threshold: [0.6] },
    );
    const observed = [];
    reels.forEach((r) => { const el = reelRefs.current[r.id]; if (el) { io.observe(el); observed.push(el); } });
    return () => { observed.forEach((el) => io.unobserve(el)); io.disconnect(); };
  }, [reels]);
  // Reset to top when the intent filter changes.

  useEffect(() => { wrapRef.current?.scrollTo({ top: 0 }); setActive(0); }, [filter]);

  const goTo = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(reels.length - 1, idx));
    const el = reelRefs.current[reels[clamped]?.id];
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }, [reels, reduced]);
  // Story-style auto-advance. With no segmented progress bar there is nothing to paint per frame,
  // so one timer does the job of a rAF loop.

  useEffect(() => {
    if (!playing || reduced || reels.length === 0) return undefined;
    const timer = setTimeout(() => {
      setActive((prev) => {
        if (prev < reels.length - 1) {
          reelRefs.current[reels[prev + 1]?.id]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
          return prev + 1;
        }
        setPlaying(false);
        return prev;
      });
    }, TOUR_MS);
    return () => clearTimeout(timer);
  }, [playing, reduced, active, reels]);
  // Keyboard navigation (reads active via ref to avoid re-binding each change).

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); goTo(activeRef.current + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); goTo(activeRef.current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);

  const like = (id, force) => setLiked((s) => {
    const on = force !== undefined ? force : !s.has(id);
    if (on === s.has(id)) return s;
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const doBurst = (id) => { like(id, true); setBurst({ id, key: ++burstSeq.current }); };

  const save = async (r) => {
    // Toast on the settled state, not the intent: if the write failed the context rolls back, and
    // "Saved" over a property that was not saved is worse than no toast at all.
    if (saved.busyIds?.has(r.id)) return;
    const wasSaved = saved.has(r.id);
    const ok = wasSaved ? await saved.unsave(r.id, r.uuid) : await saved.save(r.id, r.uuid);
    if (!ok) {
      toast(t('saved.updateFailed', { defaultValue: "Couldn't update saved homes. Try again." }), 'error');
      return;
    }
    toast(wasSaved ? t('reels.removedToast', { title: r.title }) : t('reels.savedToast', { title: r.title }), wasSaved ? 'info' : 'success');
  };

  const shareReel = async (r) => {
    const url = window.location.origin + '/property/' + r.id;
    const text = t('reels.shareText', { title: r.title, price: priceLabel(r) });
    if (navigator.share) {
      try { await navigator.share({ title: r.title, text, url }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(`${text} — ${url}`), '_blank');
  };
  // Media tap: double-tap → like burst, single tap → play/pause.

  const onMediaTap = (id) => {
    const now = Date.now();
    const last = tapRef.current;
    if (last.id === id && now - last.time < 280) {
      if (last.t) clearTimeout(last.t);
      tapRef.current = { time: 0, id: null, t: null };
      doBurst(id);
      return;
    }
    const t = setTimeout(() => setPlaying((p) => !p), 280);
    tapRef.current = { time: now, id, t };
  };
  // Horizontal photo swipe: derive the active photo index from scroll position.

  const onGalleryScroll = (id, el) => {
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setPhotoIdx((m) => (m[id] === idx ? m : { ...m, [id]: idx }));
  };

  return (
      /* Top overlay: brand + intent filters */
    <div className="reels-page">
      <header className="reels-top">
        <div className="reels-topbar">
          <div className="reels-brand">
            <Icon name="video" className="w-4 h-4 text-brand-teal-3" />
            <span>{t('reels.brand')}</span>
            <span className="reels-hint">{t('reels.hint')}</span>
          </div>
          <div className="reels-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`reels-chip${filter === f.key ? ' is-on' : ''}`}
                aria-pressed={filter === f.key}
              >
                <Icon name={f.icon} className="w-3.5 h-3.5" /> {t(f.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </header>

        {/* Two distinct nothing-states. */}
      <div className="reel-wrap" ref={wrapRef}>
        {feed === null && (
          <div className="reel-note" role="status">
            <Icon name="video" className="w-8 h-8 text-brand-teal-3" />
            <p>{t('reels.loading')}</p>
          </div>
        )}
        {feed !== null && reels.length === 0 && (
          <div className="reel-note">
            <Icon name="video" className="w-8 h-8 text-brand-teal-3" />
            <p className="reel-note__title">{t('reels.emptyTitle')}</p>
            <p>{t('reels.emptyBody')}</p>
            <Link to="/listings" className="reel-note__cta">{t('reels.browseAll')}</Link>
          </div>
        )}
        {reels.map((r, i) => (
            /* Horizontal photo carousel for this property */
          <section key={r.id} data-idx={i} ref={setReelRef(r.id)} className="reel">
            <div
              className="reel-gallery"
              role="button"
              tabIndex={-1}
              aria-label={t('reels.galleryAria', { title: r.title })}
              onClick={() => onMediaTap(r.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); } }}
              onScroll={(e) => onGalleryScroll(r.id, e.currentTarget)}
            >
              {r.photos.map((src, pi) => (
                <div key={pi} className="reel-slide">
                  <div
                    className={`reel-slide-img${playing && i === active && (photoIdx[r.id] || 0) === pi && !reduced ? ' is-live' : ''}`}
                    style={{ backgroundImage: `url(${src})` }}
                  />
                </div>
              ))}
            </div>
            <div className="reel-scrim" aria-hidden="true" />
            {/* Center play/pause badge */}

            <div className={`play-badge${playing && i === active ? ' is-playing' : ''}`} aria-hidden="true">
              <Icon name={playing && i === active ? 'timer' : 'play'} weight="fill" className="w-7 h-7 text-white" />
            </div>

            {burst && burst.id === r.id && (
              <span key={burst.key} className="reel-heart-burst" aria-hidden="true">
                <Icon name="heart" weight="fill" className="w-24 h-24" />
              </span>
            )}

            <div className="rail">
              <button type="button" onClick={() => like(r.id)} aria-label={liked.has(r.id) ? t('reels.unlike') : t('reels.like')} aria-pressed={liked.has(r.id)} className={liked.has(r.id) ? 'is-liked' : ''}>
                <span className="ic"><Icon name="heart" weight={liked.has(r.id) ? 'fill' : 'regular'} className="w-5 h-5" /></span>
                <span className="lb">{liked.has(r.id) ? t('reels.liked') : t('reels.like')}</span>
              </button>
              <button type="button" onClick={() => save(r)} aria-label={saved.has(r.id) ? t('reels.removeSaved') : t('reels.saveProperty')} aria-pressed={saved.has(r.id)} className={saved.has(r.id) ? 'is-saved' : ''}>
                <span className="ic"><Icon name="bookmark" weight={saved.has(r.id) ? 'fill' : 'regular'} className="w-5 h-5" /></span>
                <span className="lb">{saved.has(r.id) ? t('reels.saved') : t('reels.save')}</span>
              </button>
              <button type="button" onClick={() => shareReel(r)} aria-label={t('reels.shareAria')}>
                <span className="ic"><Icon name="send" className="w-5 h-5" /></span><span className="lb">{t('reels.share')}</span>
              </button>
              <Link to={`/property/${r.id}`} aria-label={t('reels.viewHome')} className="is-cta">
                <span className="ic"><Icon name="eye" className="w-5 h-5" /></span><span className="lb">{t('reels.viewHome')}</span>
              </Link>
              <Link to={`/contact?ref=${r.id}`} aria-label={t('reels.contactAria')}>
                <span className="ic"><Icon name="phone" className="w-5 h-5" /></span><span className="lb">{t('reels.contact')}</span>
              </Link>
            </div>

            <div className="reel-info">
              {r.photos.length > 1 && (
                <div className="reel-dots" role="tablist" aria-label={t('reels.photoAria')}>
                  {r.photos.map((_, pi) => (
                    <span key={pi} className={`reel-dot${(photoIdx[r.id] || 0) === pi ? ' is-on' : ''}`} />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {r.deal === 'rent'
                  ? <span className="reels-badge bg-teal-600/70 text-teal-50">{t('reels.badgeRent')}</span>
                  : <span className="reels-badge bg-emerald-600/70 text-emerald-50">{t('reels.badgeSale')}</span>}
                <span className="reels-badge text-white" style={{ background: 'rgb(var(--dz-c-emerald-500) / .85)' }}>{t('reels.zeroBrokerage')}</span>
                <span className="reels-tag"><Icon name="camera" className="w-3 h-3" /> {t('reels.photoCount', { count: r.photos.length })}</span>
                <span className="reels-tag"><Icon name="eye" className="w-3 h-3" /> {compact(r.views)}</span>
              </div>
              <h2 className="text-2xl font-extrabold">{priceLabel(r)}</h2>
              <p className="text-gray-200 font-semibold">{r.title}</p>
              <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-0.5"><Icon name="map-pin" className="w-4 h-4 text-brand-teal-3" /> {t('reels.meta', { loc: r.loc, bhk: r.bhk, area: r.area })}</p>
            </div>
          </section>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reels[active] ? t('reels.viewingStatus', { title: reels[active].title, loc: reels[active].loc }) : ''}
      </div>
    </div>
  );
}
