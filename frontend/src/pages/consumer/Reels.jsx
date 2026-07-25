import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { fmtINR, rentLabel } from '../../lib/format.js';
import { getSavedProps, toggleSavedProp } from '../../lib/store.js';
import { useToast } from '../../context/ToastContext.jsx';

// Curated tour feed mapped to real listing IDs (P50xx) so every CTA resolves.
// Each reel carries a small photo set that swipes horizontally within the property.
const P = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80`;
const REELS = [
  { id: 'P5000', photos: [P('1600596542815-ffad4c1539a9'), P('1616594039964-ae9021a400a0'), P('1556911220-bff31c812dba')], title: '3 BHK in Magarpatta City', loc: 'Magarpatta', deal: 'rent', price: 42000, bhk: 3, area: 1500, likes: 214, views: 4355, tag: 'Owner tour' },
  { id: 'P5006', photos: [P('1600585154340-be6161a56a0c'), P('1522708323590-d24dbb6b0267'), P('1484154218962-a197022b5858')], title: '2 BHK near IT Park', loc: 'Hinjawadi', deal: 'rent', price: 24000, bhk: 2, area: 980, likes: 158, views: 7712, tag: 'Owner tour' },
  { id: 'P5008', photos: [P('1600047509807-ba8f99d2cdde'), P('1493809842364-78817add7ffb'), P('1600210492486-724fe5c67fb0')], title: '3 BHK Sky Residence', loc: 'Baner', deal: 'buy', price: 13500000, bhk: 3, area: 1650, likes: 402, views: 6930, tag: 'Drone view' },
  { id: 'P5007', photos: [P('1600566753086-00f18fb6b3ea'), P('1556909212-d5b604d0c90d'), P('1616486338812-3dadae4b4ace')], title: '2 BHK Studio Home', loc: 'Balewadi', deal: 'rent', price: 26000, bhk: 2, area: 1050, likes: 189, views: 3133, tag: 'Walkthrough' },
  { id: 'P5010', photos: [P('1512917774080-9991f1c4c750'), P('1600607687939-ce8a6c25118c'), P('1583847268964-b28dc8f51f92')], title: '3 BHK Villa', loc: 'Undri', deal: 'buy', price: 9500000, bhk: 3, area: 1400, likes: 664, views: 5754, tag: 'Owner tour' },
  { id: 'P5013', photos: [P('1560448204-e02f11c3d0e2'), P('1560185007-cde436f6a4d0'), P('1522708323590-d24dbb6b0267')], title: '1 BHK Cozy Flat', loc: 'Baner', deal: 'rent', price: 18000, bhk: 1, area: 620, likes: 293, views: 6890, tag: 'Walkthrough' },
  { id: 'P5015', photos: [P('1600607687939-ce8a6c25118c'), P('1600585154340-be6161a56a0c'), P('1616594039964-ae9021a400a0')], title: '2 BHK Row House', loc: 'Wakad', deal: 'rent', price: 27000, bhk: 2, area: 1080, likes: 955, views: 5205, tag: 'Owner tour' },
  { id: 'P5017', photos: [P('1502672260266-1c1ef2d93688'), P('1600210492486-724fe5c67fb0'), P('1556911220-bff31c812dba')], title: '4 BHK Penthouse', loc: 'Koregaon Park', deal: 'buy', price: 34000000, bhk: 4, area: 3200, likes: 1172, views: 5324, tag: 'Society tour' },
];

const FILTERS = [
  { key: 'all', label: 'All', icon: 'sparkles' },
  { key: 'rent', label: 'Rent', icon: 'key' },
  { key: 'buy', label: 'Buy', icon: 'home' },
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
  const { toast } = useToast();
  const [reduced, setReduced] = useState(prefersReducedMotion);

  const [filter, setFilter] = useState('all');
  const reels = useMemo(() => (filter === 'all' ? REELS : REELS.filter((r) => r.deal === filter)), [filter]);

  const [likes, setLikes] = useState(() => Object.fromEntries(REELS.map((r) => [r.id, { n: r.likes, on: false }])));
  const [saved, setSaved] = useState(() => new Set(getSavedProps()));
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(!prefersReducedMotion());
  const [burst, setBurst] = useState(null); // { id, key }
  const [photoIdx, setPhotoIdx] = useState({}); // { [reelId]: activePhotoIndex }

  const wrapRef = useRef(null);
  const reelRefs = useRef({});
  const tapRef = useRef({ time: 0, id: null, t: null });
  const activeRef = useRef(0);
  const fillRef = useRef(null); // active reel's progress-bar fill node
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

  // Story-style auto-advance. Drives the active fill node directly (no per-frame
  // React state) so 60fps progress never re-renders the reel tree.
  useEffect(() => {
    if (!playing || reduced || reels.length === 0) return undefined;
    let raf; let start = null;
    const step = (ts) => {
      if (start === null) start = ts;
      const pct = Math.min(100, ((ts - start) / TOUR_MS) * 100);
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (pct >= 100) {
        setActive((prev) => {
          if (prev < reels.length - 1) {
            reelRefs.current[reels[prev + 1]?.id]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
            return prev + 1;
          }
          setPlaying(false);
          return prev;
        });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
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

  const like = (id, force) => setLikes((m) => {
    const cur = m[id];
    const on = force !== undefined ? force : !cur.on;
    if (on === cur.on) return m;
    return { ...m, [id]: { n: on ? cur.n + 1 : cur.n - 1, on } };
  });

  const doBurst = (id) => { like(id, true); setBurst({ id, key: ++burstSeq.current }); };

  const save = (r) => {
    const nowSaved = toggleSavedProp(r.id);
    setSaved((s) => { const next = new Set(s); if (nowSaved) next.add(r.id); else next.delete(r.id); return next; });
    toast(nowSaved ? `Saved ${r.title} to your shortlist` : `Removed ${r.title} from saved`, nowSaved ? 'success' : 'info');
  };

  const shareReel = async (r) => {
    const url = window.location.origin + '/property/' + r.id;
    const text = `Check this home on PuneNest: ${r.title} · ${priceLabel(r)}`;
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
      {/* Top overlay: brand + intent filters + segmented progress */}
      <header className="reels-top">
        <nav className="reels-progress" aria-label="Reel navigation">
          {reels.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className="reels-seg"
              aria-label={`Go to reel ${i + 1}: ${r.title}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => goTo(i)}
            >
              <span
                ref={i === active ? fillRef : null}
                className="reels-seg-fill"
                style={{ width: i < active ? '100%' : '0%' }}
              />
            </button>
          ))}
        </nav>
        <div className="reels-topbar">
          <div className="reels-brand">
            <Icon name="video" className="w-4 h-4 text-brand-teal-3" />
            <span>Reels</span>
            <span className="reels-hint">Double-tap to ❤️ · tap to pause</span>
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
                <Icon name={f.icon} className="w-3.5 h-3.5" /> {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="reel-wrap" ref={wrapRef}>
        {reels.map((r, i) => (
          <section key={r.id} data-idx={i} ref={setReelRef(r.id)} className="reel">
            {/* Horizontal photo carousel for this property */}
            <div
              className="reel-gallery"
              role="button"
              tabIndex={-1}
              aria-label={`${r.title}. Swipe for more photos. Tap to play or pause, double-tap to like.`}
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
              <button type="button" onClick={() => like(r.id)} aria-label={likes[r.id].on ? 'Unlike' : 'Like'} aria-pressed={likes[r.id].on} className={likes[r.id].on ? 'is-liked' : ''}>
                <span className="ic"><Icon name="heart" weight={likes[r.id].on ? 'fill' : 'regular'} className="w-5 h-5" /></span>
                <span>{compact(likes[r.id].n)}</span>
              </button>
              <button type="button" onClick={() => save(r)} aria-label={saved.has(r.id) ? 'Remove from saved' : 'Save property'} aria-pressed={saved.has(r.id)} className={saved.has(r.id) ? 'is-saved' : ''}>
                <span className="ic"><Icon name="bookmark" weight={saved.has(r.id) ? 'fill' : 'regular'} className="w-5 h-5" /></span>
                {saved.has(r.id) ? 'Saved' : 'Save'}
              </button>
              <button type="button" onClick={() => shareReel(r)} aria-label="Share this home">
                <span className="ic"><Icon name="send" className="w-5 h-5" /></span>Share
              </button>
            </div>

            <div className="relative z-[4] p-5 pb-8 w-full">
              {r.photos.length > 1 && (
                <div className="reel-dots" role="tablist" aria-label="Photo">
                  {r.photos.map((_, pi) => (
                    <span key={pi} className={`reel-dot${(photoIdx[r.id] || 0) === pi ? ' is-on' : ''}`} />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {r.deal === 'rent'
                  ? <span className="reels-badge bg-teal-600/70 text-teal-50">Rent</span>
                  : <span className="reels-badge bg-emerald-600/70 text-emerald-50">Sale</span>}
                <span className="reels-badge text-white" style={{ background: 'rgba(16,185,129,.85)' }}>₹0 Brokerage</span>
                <span className="reels-tag"><Icon name="camera" className="w-3 h-3" /> {r.photos.length} photos</span>
                <span className="reels-tag"><Icon name="eye" className="w-3 h-3" /> {compact(r.views)}</span>
              </div>
              <h2 className="text-2xl font-extrabold">{priceLabel(r)}</h2>
              <p className="text-gray-200 font-semibold">{r.title}</p>
              <p className="text-gray-400 text-sm flex items-center gap-1.5 mt-0.5"><Icon name="map-pin" className="w-4 h-4 text-brand-teal-3" /> {r.loc}, Pune · {r.bhk} BHK · {r.area} sq.ft</p>
              <div className="reels-cta-row">
                <Link to={`/property/${r.id}`} className="reels-cta reels-cta--primary"><Icon name="eye" className="w-4 h-4" /> View home</Link>
                <Link to={`/contact?ref=${r.id}`} aria-label="Contact owner" className="reels-cta reels-cta--ghost"><Icon name="phone" className="w-4 h-4" /> Contact</Link>
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reels[active] ? `Viewing ${reels[active].title} in ${reels[active].loc}` : ''}
      </div>
    </div>
  );
}
