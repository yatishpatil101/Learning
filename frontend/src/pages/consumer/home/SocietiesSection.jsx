import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { listSocietiesWithListings } from '../../../services/societyService.js';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * How early to start fetching, in pixels of scroll ahead of the rail: far enough that the request
 * is in flight before the strip is legible, close enough that a hero-only visit never pays for it.
 */
const PREFETCH_MARGIN = '400px';

/** Placeholder keys, one per card the rail shows, so the reserved row is the shape of the answer. */
const SKELETONS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * Home discovery entry point for the Society Hub: the strongest few societies, with everything else
 * routed to /societies. Mirrors the "Explore by property type" strip so the two rows read alike.
 */
export default function SocietiesSection() {
  const navigate = useNavigate();
  /* `null` is "not asked yet, or still in flight", a different fact from an empty catalogue — and
     the scroll gate means the visitor is looking at the section through that window. */
  const [societies, setSocieties] = useState(null);
  const rootRef = useRef(null);
  const [inView, setInView] = useState(false);
  const scrollRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  /* Nothing is requested until the rail is nearly on screen, so this never competes with the hero
     for the entry route's connections. Without `IntersectionObserver`, fetch immediately. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver !== 'function') { setInView(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin: PREFETCH_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* From the seam, never from `data/societies.js`: a bundled society the server has dropped would
     link to a dead hub. `hasListings=true` narrows it to one page — see the flow doc, § 9.4. */
  useEffect(() => {
    if (!inView) return undefined;
    let alive = true;
    listSocietiesWithListings()
      .then(({ rows }) => { if (alive) setSocieties(rows); })
      .catch((err) => {
        /* An empty strip, not a broken page: nothing else depends on this rail. Logged rather than
           swallowed, so a catalogue outage is diagnosable. */
        console.warn('[home] society catalogue unavailable', err);
        if (alive) setSocieties([]);
      });
    return () => { alive = false; };
  }, [inView]);

  const top = useMemo(() => (societies || [])
    .map((soc) => {
      /* `source`, not `tier` — the vocabulary the directory uses, so an ops-confirmed society is
         badged on what it is now rather than on what it was minted with. */
      const community = soc.source === 'community';
      const verified = !!soc.verifiedAt || (!community && !!(soc.registration && soc.conveyance));
      return {
        slug: soc.slug, name: soc.name, localitySlug: soc.localitySlug || '',
        /* The server's count: summed over the merge family and correct for listings this screen
           never sees. The "New" branch is unreachable here, kept because the card is generic. */
        verified, homes: soc.listingCount,
      };
    })
    /* No rating tie-break between `homes` and `name`: adding one is a product decision about what
       "strongest" means, and an arbitrary sort key reads as intentional. */
    .sort((a, b) => (Number(b.verified) - Number(a.verified)) || (b.homes - a.homes) || a.name.localeCompare(b.name))
    .slice(0, 8), [societies]);

  // Arrows track whether there is more to scroll; the fades track whether a card is actually
  // clipped by that edge. Same mechanics as the property-type strip.
  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanPrev(scrollLeft > 4);
    setCanNext(scrollLeft < scrollWidth - clientWidth - 4);

    const stripLeft = el.getBoundingClientRect().left;
    const TH = 8;
    let leftCut = false;
    let rightCut = false;
    el.querySelectorAll('.cat-card').forEach((c) => {
      const r = c.getBoundingClientRect();
      const left = r.left - stripLeft;
      const right = r.right - stripLeft;
      if (left < -TH && right > TH) leftCut = true;
      if (left < clientWidth - TH && right > clientWidth + TH) rightCut = true;
    });
    setFadeLeft(leftCut);
    setFadeRight(rightCut);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [updateArrows]);

  // When listings resolve the strip re-sorts and scroll-snap `mandatory` re-snaps to the reordered
  // child, yanking the strip to the far end — so pin it back once the dataset settles.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = 0;
    updateArrows();
  }, [top, updateArrows]);

  const scrollByPage = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const arrowBtn = (dir, label, icon, enabled) => (
    <button
      type="button"
      onClick={() => scrollByPage(dir)}
      // The skeletons overflow the rail exactly as the real cards do, so `canNext` is true while
      // the fetch is still out. Paging through placeholders is not an interaction.
      disabled={!enabled || societies === null}
      aria-label={label}
      className="hscroll-arrow grid place-items-center w-9 h-9 rounded-full glass border border-white/10 text-gray-200 transition-all hover:border-teal-400/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10 disabled:hover:text-gray-200"
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );

  return (
    <section ref={rootRef} aria-labelledby="home-societies-heading" className="relative section-y">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="section-head flex items-end justify-between gap-3 sm:mb-3 reveal">
          <div className="min-w-0">
            <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-1.5">Browse by society</p>
            <h2 id="home-societies-heading" className="text-2xl sm:text-3xl font-bold">Explore Pune societies</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {arrowBtn(-1, 'Scroll societies left', 'chevron-left', canPrev)}
            {arrowBtn(1, 'Scroll societies right', 'chevron-right', canNext)}
            <button onClick={() => navigate('/societies')} className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-teal-400 hover:text-teal-300 transition-colors group">
              View all societies <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>

        <div className="relative -mx-4 sm:-mx-6 lg:mx-0">
          {/* `min-h` is load-bearing: the fetch is scroll-gated, so cards can land while the section
             is on screen and would push everything below it under the reader's thumb. */}
          <div ref={scrollRef} aria-busy={societies === null} className="cat-scroll flex gap-3 overflow-x-auto pt-3 pb-3 px-4 sm:px-6 lg:px-0 scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 min-h-[104px] reveal" style={{ scrollSnapType: 'x mandatory' }}>
            {societies === null ? SKELETONS.map((k) => (
              <div key={k} aria-hidden="true" className="flex-shrink-0 glass rounded-2xl flex items-center gap-4 px-5 py-4 animate-pulse" style={{ minWidth: '220px' }}>
                <div className="w-12 h-12 rounded-xl bg-white/5 shrink-0" />
                <div className="min-w-0 space-y-2">
                  <div className="h-3 w-28 rounded bg-white/5" />
                  <div className="h-2.5 w-20 rounded bg-white/5" />
                </div>
              </div>
            )) : null}
            {/* Resolved and empty is a claim, so it is said rather than left as a header over a
               blank box. Reached by a catalogue outage, or by no society having a live listing. */}
            {societies !== null && top.length === 0 ? (
              <p className="text-sm text-gray-400 py-6">No societies with homes listed just yet.</p>
            ) : null}
            {top.map((s) => {
              const loc = titleCase(s.localitySlug);
              const homesTxt = s.homes ? `${s.homes} home${s.homes > 1 ? 's' : ''}` : 'New';
              return (
                <Link
                  key={s.slug}
                  to={`/society/${s.slug}`}
                  className="cat-card flex-shrink-0 glass rounded-2xl cursor-pointer group flex items-center gap-4 px-5 py-4 hover:border-white/15 transition-all duration-300"
                  style={{ scrollSnapAlign: 'start', minWidth: '220px' }}
                >
                  <div className="w-12 h-12 rounded-xl bg-brand-teal/10 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
                    <Icon name="building-2" className="w-6 h-6 text-brand-teal-3" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="font-semibold text-sm text-white leading-tight flex items-center gap-1.5">
                      <span className="truncate">{s.name}</span>
                      {s.verified ? <Icon name="badge-check" className="w-3.5 h-3.5 text-brand-teal-3 shrink-0" /> : null}
                    </p>
                    <p className="text-xs mt-0.5 text-brand-teal-3 truncate">
                      {loc ? `${loc} · ` : ''}{homesTxt}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="cat-fade cat-fade--left" aria-hidden="true" style={{ opacity: fadeLeft ? 1 : 0, transition: 'opacity .3s ease' }} />
          <div className="cat-fade cat-fade--right" aria-hidden="true" style={{ opacity: fadeRight ? 1 : 0, transition: 'opacity .3s ease' }} />
        </div>

        {/* Mobile equivalent of the desktop-only header link — same pattern as
           Featured / Categories, so no rail loses its escape hatch on a phone. */}
        <button
          onClick={() => navigate('/societies')}
          className="sm:hidden mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-teal-400 hover:bg-white/10 hover:text-teal-300 transition-all"
        >
          View all societies <Icon name="arrow-right" className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
