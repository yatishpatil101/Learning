import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { listProperties } from '../../../services/propertyService.js';
import { listSocietyCatalogue } from '../../../services/societyService.js';
import { listingsInSociety } from '../../../data/societies.js';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Home discovery entry point for the Society Hub. Kept off the navbar (too prime)
 * and given its own section so society-first seekers can browse buildings directly.
 * Surfaces the strongest few societies (verified + most homes listed) and routes
 * everything else to the full /societies directory. Mirrors the "Explore by
 * property type" strip (compact icon-left tiles + prev/next arrows + edge fades)
 * so the two home rows read as the same component family.
 */
export default function SocietiesSection() {
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [societies, setSocieties] = useState([]);
  const scrollRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  useEffect(() => {
    let alive = true;
    listProperties({}).then((all) => { if (alive) setListings(all); });
    return () => { alive = false; };
  }, []);

  /* The catalogue, from the seam rather than from `data/societies.js` merged with `resolveSociety`.

     The bundle was measurably right: ranked both ways against the live server, this strip's eight
     cards came out identical, because `R__seed_reference_data.sql` seeds `societies` from the same
     rows the bundle ships and not one of the 347 shared slugs disagreed on `registration` or
     `conveyance`. So this is not a rendering bug being fixed. It is the guarantee underneath it:
     the two agreed because nothing had yet made them disagree, and two copies of the same table
     only drift in one direction. The probe found the drift already starting — one bundled society
     no longer exists on the server, and would link to a hub that renders "no such society" if it
     ever ranked into the top eight, which today it does not by luck rather than by design.

     The cost is honest: two round trips of latency (page 0, then the rest in parallel), on a strip
     that sits below the hero, paints progressively, and already awaits `listProperties({})`. The
     older note here rejected exactly this read for a *rating tie-break* — a term that would have
     changed nothing visible. This one decides which societies appear at all. */
  useEffect(() => {
    let alive = true;
    listSocietyCatalogue()
      .then(({ rows }) => { if (alive) setSocieties(rows); })
      .catch((err) => {
        /* An empty strip, not a broken one: this is a discovery rail below the fold, and the rest
           of the home page does not depend on it. Logged rather than swallowed so a catalogue
           outage is diagnosable instead of looking like a platform with no societies on it. */
        console.warn('[home] society catalogue unavailable', err);
        if (alive) setSocieties([]);
      });
    return () => { alive = false; };
  }, []);

  const top = useMemo(() => societies
    .map((soc) => {
      /* `source`, not `tier` — the same vocabulary the directory settled on. The mock provider
         translates its `tier` into this field at the seam, so both modes answer in the server's
         words, and an ops-confirmed society stops being badged unchecked rather than being stuck
         that way for as long as it keeps whatever flag it was minted with. */
      const community = soc.source === 'community';
      const verified = !!soc.verifiedAt || (!community && !!(soc.registration && soc.conveyance));
      return {
        slug: soc.slug, name: soc.name, localitySlug: soc.localitySlug || '',
        verified, homes: listingsInSociety(listings, soc.slug).length,
      };
    })
    /* D196: there used to be a rating tie-break between `homes` and `name`, read from the
       `pnEntityReviews` localStorage bucket. A live session never writes that bucket, so the
       term was a constant zero against the real API and the ordering it promised never happened
       — an inert sort key is worse than no sort key, because it reads as intentional.

       The aggregate is on every row this now reads (`GET /societies` sends `avgRating` beside the
       rest), so the cost argument that retired the tie-break no longer applies. Restoring it is
       still a product decision about what "strongest" means and not a port, so it stays out until
       somebody makes that call deliberately. */
    .sort((a, b) => (Number(b.verified) - Number(a.verified)) || (b.homes - a.homes) || a.name.localeCompare(b.name))
    .slice(0, 8), [societies, listings]);

  // Reflect the strip's scroll position in the arrow enabled-state and the edge
  // fades — identical mechanics to the property-type strip so both rows behave
  // the same. Arrows track whether there is more to scroll; the fades track
  // whether a card is actually clipped by that edge.
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

  // When listings resolve the strip re-sorts, and scroll-snap `mandatory` re-snaps
  // to the reordered child — which yanks the strip to the far end on load. Pin it
  // back to the start once the dataset settles, then refresh the arrow state.
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
      disabled={!enabled}
      aria-label={label}
      className="hscroll-arrow grid place-items-center w-9 h-9 rounded-full glass border border-white/10 text-gray-200 transition-all hover:border-teal-400/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10 disabled:hover:text-gray-200"
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );

  return (
    <section className="relative section-y">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="section-head flex items-end justify-between gap-3 sm:mb-3 reveal">
          <div className="min-w-0">
            <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-1.5">Browse by society</p>
            <h2 className="text-2xl sm:text-3xl font-bold">Explore Pune societies</h2>
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
          <div ref={scrollRef} className="cat-scroll flex gap-3 overflow-x-auto pt-3 pb-3 px-4 sm:px-6 lg:px-0 scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 reveal" style={{ scrollSnapType: 'x mandatory' }}>
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
