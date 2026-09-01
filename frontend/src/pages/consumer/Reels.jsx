import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import '../../styles/routes/reels.css';
import { fmtINR, rentLabel } from '../../lib/format.js';
import { listProperties, getProperty } from '../../services/propertyService.js';
import { isResidentialHome } from '../../data/propertyTypes.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/* The feed is the live catalogue, not a curated list — it used to be eight hardcoded
   entries with stock photos whose CTAs merely *pointed* at real IDs, so a newly posted
   home could never appear here and the captions could drift from the listing they
   linked to. Two gates decide what earns a reel:

     isResidentialHome  Reels is deliberately homes-only (see data/propertyTypes.js).
                        Land and commercial are reachable from /listings instead.
     MIN_PHOTOS         A reel is a walkthrough. One or two frames is a card, not a
                        tour, and swiping into a dead end reads as a broken listing. */
const MIN_PHOTOS = 3;
/* Past this the horizontal swipe outlasts the viewer, and the vertical feed — which is
   the point of the page — stops advancing. The rest of the gallery is on the detail page. */
const MAX_PHOTOS = 5;
/* How many listings the feed will open detail requests for. The catalogue read tells us who
   *qualifies*; only the detail response carries the photos themselves, so every reel costs a second
   request. That is fine at today's dozen-and-a-half and would not be at five hundred, and a feed
   nobody scrolls to the bottom of gains nothing from the tail. */
const FEED_MAX = 24;

/* How many photos this listing has, which is not the same as which ones it has.

   A card row carries `photoCount` and an empty `gallery`; a detail row carries both and they agree.
   Reading `gallery.length` on a list row is exactly the bug this replaces — it has never been
   populated there, so every listing scored zero, no listing ever cleared MIN_PHOTOS, and the feed
   was permanently empty while looking like a slow network. */
const photoCountOf = (p) => p.photoCount ?? (p.gallery || []).length;

const toReel = (p) => ({
  id: p.id,
  photos: (p.gallery || []).slice(0, MAX_PHOTOS),
  title: p.title,
  loc: p.locality,
  deal: p.deal,
  price: p.price,
  bhk: p.bhkNum,
  area: p.area,
  views: p.views,
});

const FILTERS = [
  { key: 'all', labelKey: 'reels.filterAll', icon: 'sparkles' },
  { key: 'rent', labelKey: 'reels.filterRent', icon: 'key' },
  { key: 'buy', labelKey: 'reels.filterBuy', icon: 'home' },
];

const TOUR_MS = 7000; // auto-advance duration per reel
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
  const [feed, setFeed] = useState(null); // null until the catalogue resolves

  useEffect(() => {
    let alive = true;
    /* Two rounds, because the two halves of a reel live on two different responses.

       The catalogue read decides *who qualifies* — homes only, and enough frames to be a walkthrough
       rather than a card — from `photoCount`, which is the only thing about the gallery a card row
       carries. The detail read then supplies the photos themselves, and `views` with them, for the
       handful that survive.

       Filtering first and fetching second is the whole point: the alternative is opening a detail
       request for every listing in the catalogue to discover that most of them have one photo. */
    listProperties({}, 'newest').then(async (all) => {
      if (!alive) return;
      const eligible = all
        .filter((p) => isResidentialHome(p.type) && photoCountOf(p) >= MIN_PHOTOS)
        .slice(0, FEED_MAX);

      const hydrated = await Promise.all(eligible.map(async (p) => {
        // Already complete in mock mode, where the list rows carry their galleries. Skipping the
        // fetch there keeps this one code path honest in both modes instead of two.
        if ((p.gallery || []).length >= MIN_PHOTOS) return p;
        try {
          return (await getProperty(p.id)) || null;
        } catch {
          // One listing failing to open is not a reason to show an empty feed. Drop it and keep the
          // rest — the gate below re-checks, so a partial detail cannot slip through as a one-frame
          // "tour".
          return null;
        }
      }));

      if (!alive) return;
      setFeed(hydrated
        .filter((p) => p && (p.gallery || []).length >= MIN_PHOTOS)
        .map(toReel));
    }).catch(() => {
      // `feed` stays null forever on a rejection, and null is the loading state —
      // so a failed catalogue read renders "loading" indefinitely, which is exactly
      // the dead-end-disguised-as-slow-network this screen's empty state exists to
      // avoid. Fall through to the empty state instead.
      if (alive) setFeed([]);
    });
    return () => { alive = false; };
  }, []);

  const reels = useMemo(() => {
    const list = feed || [];
    return filter === 'all' ? list : list.filter((r) => r.deal === filter);
  }, [feed, filter]);

  /* Liked is session-only and intentionally uncounted. There is no like on a listing
     to read, so any number next to the heart would be invented — and the badge row
     already carries `views`, which is real. The heart stays because double-tap is the
     gesture this surface is built on. */
  const [liked, setLiked] = useState(() => new Set());
  // The context exposes the same `has(id)` the local Set did, so the markup below is unchanged.
  const saved = useSaved();
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(!prefersReducedMotion());
  const [burst, setBurst] = useState(null); // { id, key }
  const [photoIdx, setPhotoIdx] = useState({}); // { [reelId]: activePhotoIndex }

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

  // Story-style auto-advance. With the segmented progress bar gone there is nothing
  // to paint per frame, so a single timer replaces the old rAF loop.
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
    const nowSaved = await saved.toggle(r.id, r.uuid);
    toast(nowSaved ? t('reels.savedToast', { title: r.title }) : t('reels.removedToast', { title: r.title }), nowSaved ? 'success' : 'info');
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
    <div className="reels-page">
      {/* Top overlay: brand + intent filters */}
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

      <div className="reel-wrap" ref={wrapRef}>
        {/* Two distinct nothing-states. "Loading" means the catalogue has not resolved;
            "empty" means it did and this intent has no tourable home in it. Collapsing
            them into one spinner leaves a real dead end looking like a slow network. */}
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
          <section key={r.id} data-idx={i} ref={setReelRef(r.id)} className="reel">
            {/* Horizontal photo carousel for this property */}
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
              {/* The two CTAs live on the rail rather than as a full-width row, so the
                  photo keeps the bottom third of the screen it used to give away. */}
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
                <span className="reels-badge text-white" style={{ background: 'rgba(16,185,129,.85)' }}>{t('reels.zeroBrokerage')}</span>
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
