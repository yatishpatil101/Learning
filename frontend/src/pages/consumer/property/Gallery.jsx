import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { srcSetFor } from '../../../lib/imgSrcSet.js';
import { MAX_PHOTOS } from '../../../lib/uploads/policy.js';

export function Gallery({ gallery, active, setActive, title, p, flagEnabled, setLightbox, setTourOpen, requestPhotos, priceStr }) {
  const { t } = useTranslation();
  const count = gallery.length;
  const go = (dir) => setActive((i) => (i + dir + count) % count);
  /* The photo-request ask is the last SLIDE on mobile: a buyer who swiped to the end is the one who wants
     more photos. Separate from `active`, which also indexes the lightbox and would read `gallery[count]`. */
  const [ask, setAsk] = useState(false);
  const trackRef = useRef(null);
  const settle = useRef(0);
  const dragging = useRef(false);

  /* The browser's own scroller carries the photo, rather than a handler measuring a drag and
     swapping the src on release: the photo tracks the finger, keeps its momentum and rubber-bands
     at the ends, none of which a threshold can do. The scroller also owns the axis, so a diagonal
     swipe cannot both flip the slide and scroll the page. */
  const onScroll = () => {
    /* Read the SETTLED position, not the live one. `scroll` fires every frame, and committing
       `active` mid-drag re-enters the effect below, which would yank the track out from under the
       finger. Snapping is mandatory, so a settled scrollLeft is always exactly one slide.
       `scrollend` states this directly but iOS Safari only shipped it in 18.2, which is most of
       the phones this page is built for. */
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      /* Silence is not the same as release: `scroll` also stops firing when the finger stops
         MOVING, so a drag paused halfway would otherwise commit the nearer slide and let the
         effect below scroll the track backwards against a finger still holding it. */
      if (dragging.current) return;
      const el = trackRef.current;
      if (!el || !el.clientWidth) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      setAsk(i >= count);
      if (i < count) setActive(i);
    }, 120);
  };

  /* Touch, not pointer: iOS fires `pointercancel` the instant a scroll takes over the gesture, so a
     pointerup-based flag is already false for every drag this needs to see. These only observe the
     finger — the scroller still owns the gesture — and the release re-arms the settle, because a
     gesture that ends on a still finger has already spent its last `scroll` event. */
  const onTouchStart = () => { dragging.current = true; };
  const onTouchEnd = () => { dragging.current = false; onScroll(); };

  /* The lightbox, the desktop arrows, the thumbnails and the dots all move `active` without
     touching the scroller, so the track follows it from here. Instant rather than smooth: a smooth
     scroll still in flight when the next change lands is cancelled halfway, and swapping the photo
     on a tap was instant before this. The width guard makes it a no-op while the track is display:none. */
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const target = (ask ? count : active) * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollTo({ left: target, behavior: 'auto' });
  }, [active, ask, count]);

  useEffect(() => () => clearTimeout(settle.current), []);

  /* The ask is the only slide that stops existing at a width (`sm:hidden`), and a phone turned to
     landscape crosses that width. Left set, `ask` keeps aiming the effect above at a slide no longer
     in the DOM, so the track parks past the last photo and every later `setActive` is overridden.
     640px is Tailwind's `sm`, the breakpoint the slide's own class is keyed to. */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const sync = () => { if (mq.matches) setAsk(false); };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const showPhoto = (i) => { setAsk(false); setActive(i); };

  /* One dot per photo. Both the uploader and the API cap a gallery at MAX_PHOTOS, so the rail is
     never asked to stand in for more photos than it can draw, and a dot always means the photo it
     is labelled with. The clamp covers a row seeded past the cap: those park on the last dot,
     which is imprecise but never leaves the rail dark the way an uncapped `active` did. */
  const dotCount = Math.min(count, MAX_PHOTOS);
  const litDot = ask ? -1 : Math.min(active, dotCount - 1);
  return (
    <section className="fade-in mb-6 sm:mb-10">
      {/* Photos are the #1 trust signal in an Indian listing. On a phone the old
          230px letterbox read as a thumbnail; a full-bleed 4:3 hero gives them the
          weight they deserve. Both the bleed (-mx-4) and the aspect ratio are reset
          at sm:, so tablet and desktop keep today's fixed-height, inset card. */}
      <div className="relative main-image-wrapper -mx-4 sm:mx-0 rounded-none sm:rounded-2xl overflow-hidden" style={{ maxHeight: 400 }}>
        {/* One track at every width. Above sm: it stops being user-scrollable (`sm:overflow-hidden`)
            and the arrows drive it instead — an overflow:hidden box is still a scroll container and
            still answers scrollTo, so desktop keeps its single fixed-height frame without a second
            copy of the <img> and a second `view-transition-name` to keep unique. */}
        <div
          ref={trackRef}
          onScroll={onScroll}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          data-gallery-track=""
          className="no-scrollbar flex w-full aspect-[4/3] sm:aspect-auto sm:h-[320px] lg:h-[360px] overflow-x-auto sm:overflow-hidden overscroll-x-contain snap-x snap-mandatory"
        >
          {gallery.map((g, i) => (
            <img
              key={i}
              src={g}
              srcSet={srcSetFor(g)}
              sizes="(max-width: 639px) 100vw, 60vw"
              /* Only the slide on screen at load is worth the priority; the rest are one swipe away
                 at best and a full listing would otherwise fetch all ten before first paint. */
              fetchPriority={i === 0 ? 'high' : undefined}
              loading={i === 0 ? undefined : 'lazy'}
              /* Every slide is in the accessibility tree — a scroll container does not hide the
                 children the viewport has scrolled past — so one shared alt would read the listing
                 title identically up to ten times, with nothing to tell the photos apart. */
              alt={t('property.photoAlt', { title, n: i + 1, total: count })}
              onClick={() => setLightbox(true)}
              className="snap-start shrink-0 w-full h-full object-cover cursor-zoom-in"
              /* On the active slide only: the name pairs with the listing card's image
                 (listings/Card.jsx) and a second rendered element carrying it aborts the transition. */
              style={i === active ? { viewTransitionName: `property-hero-${p.id}` } : undefined}
            />
          ))}
          {/* The ask slide, last and phone-only. `relative z-20` keeps it painting over the badges
              and the price, which are absolutely positioned on the wrapper and would otherwise sit
              on top of it. Always mounted, so its button is always a tab stop: tabbing past the
              gallery scrolls the hero here, and the settle commits `ask` so the dots follow. */}
          <div data-photo-ask="" className="sm:hidden relative z-20 snap-start shrink-0 w-full h-full flex flex-col items-center justify-center gap-3 px-8 text-center bg-ink-2">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-teal-1/10 border border-brand-teal-2/30">
              <Icon name="image-plus" className="w-7 h-7 text-brand-teal-3" />
            </span>
            <p className="text-white text-base font-bold leading-snug">{t('property.requestPhotosSlideTitle')}</p>
            <p className="text-slate-400 text-xs leading-relaxed max-w-[16rem]">{t('property.requestPhotosSlideSub')}</p>
            <button
              type="button"
              onClick={requestPhotos}
              className="mt-1 inline-flex items-center gap-2 h-11 px-5 rounded-full bg-brand-teal-2 text-slate-950 text-sm font-bold active:scale-[0.98] transition-transform"
            >
              <Icon name="image-plus" className="w-4 h-4" /> {t('property.requestPhotosShort')}
            </button>
          </div>
        </div>

        {count > 1 ? (
          <>
            {/* Arrows are redundant next to a working swipe on touch, and they cover
                the photo. Hidden below sm:; the dot rail below is the touch affordance. */}
            <button type="button" onClick={() => go(-1)} aria-label={t('property.prevPhoto')} className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-left" className="w-5 h-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label={t('property.nextPhoto')} className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-right" className="w-5 h-5" /></button>
          </>
        ) : null}
        {/* Hidden below sm: on a phone the hero is full-bleed and swipeable, and this
            labelled pill covers the photo while sitting directly in the swipe path. The
            tour stays reachable from sm+ where there is room beside the photo. */}
        {flagEnabled('videoListings') && (
        <button type="button" onClick={() => setTourOpen(true)} className="absolute top-4 left-4 hidden sm:flex items-center gap-2 px-4 py-2 rounded-full glass-strong text-white text-sm font-semibold hover:bg-white/15 transition-smooth">
          <Icon name="video" className="w-4 h-4 text-brand-teal-3" /> {t('property.virtualTour')}
        </button>
        )}
        {/* The label is `hidden sm:inline`, so on a phone this collapses to a bare
            16px icon and the padding alone left it 46x34 — the control that opens the
            full-screen gallery, sitting over a photo where a near-miss scrolls the
            carousel instead. Squared off with min-* on touch only; from `sm` up the
            label is back and sizes the button on its own. */}
        <button type="button" onClick={() => setLightbox(true)} className="absolute top-4 right-4 flex items-center justify-center gap-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-3.5 py-2 rounded-full glass-strong text-white text-sm font-semibold hover:bg-white/15 transition-smooth">
          <Icon name="expand" className="w-4 h-4" /> <span className="hidden sm:inline">{t('property.fullscreen')}</span>
        </button>
        <div className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-full glass-strong text-white text-sm font-semibold">
          <Icon name="camera" className="w-4 h-4" /> <span>{active + 1}/{count}</span>
        </div>
        {/* Price, on phones only — the single most-asked question about a listing, and
            previously the first thing that fell off the bottom of a 640px screen (measured
            y=551 behind a photo-led hero). Laying it over the photo answers it without
            shrinking the photo, which is the other trust signal that sells an Indian
            listing.

            Rendered here rather than duplicated-and-hidden: the parent decides which of
            the two positions gets the price, so exactly one lives in the DOM. A hidden
            twin would give `data-testid="property-price"` two matches and read the figure
            out twice to a screen reader.

            The scrim is what makes it legible over an unknown photo — white text alone
            disappears against a bright kitchen. Both layers are pointer-events-none so
            tapping the lower third of the photo still opens the lightbox. Sits below the
            ask slide's z-20, so swiping to the ask covers the price with it. */}
        {priceStr ? (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
            <p
              data-testid="property-price"
              className="pointer-events-none absolute bottom-4 left-4 text-3xl font-extrabold text-white [text-shadow:0_1px_12px_rgba(0,0,0,.55)]"
            >
              {priceStr}
            </p>
          </>
        ) : null}
      </div>
      {/* Dot rail: replaces the desktop thumbnail strip on phones. Centred, because it is
          now the only thing on its line — it answers "where am I?" and keeps tapping as an
          alternative to swiping; the counter over the photo answers "how many". The trailing
          dot is the ask slide, drawn as a ring so it reads as "a different kind of thing"
          rather than one more photo. Each dot is a 24x44 box: the WCAG 2.5.8 floor, with
          centres far enough apart that neighbours can't steal taps.

          Buttons carrying `aria-current`, deliberately NOT a tablist: `role="tab"` promises an
          `aria-controls` panel that is shown while its siblings are hidden, and every slide here
          is in the DOM and reachable by swipe at all times. It also promises arrow-key movement
          between tabs, which nothing implements. `aria-current` claims only what is true — which
          of a set of jump targets you are on.

          `-mb-6` cancels the section's own `mb-6`: the rail's 44px touch box is a hit area,
          not spacing, and letting it stack on top of the section gap painted ~73px of dead
          air between the photo and the badges. Cancelling one against the other leaves the
          dot sitting 19px clear on both sides — symmetric, targets untouched, and the two
          boxes meet exactly rather than overlapping (an overlap would let the badges row
          swallow taps aimed at the bottom of a dot). Mobile-only; `sm:mb-0` restores the
          desktop rhythm, where this rail is hidden anyway. */}
      <div data-gallery-dots="" className="sm:hidden flex items-center justify-center -mb-6 sm:mb-0" role="group" aria-label={t('property.photoDotsAria')}>
        {Array.from({ length: dotCount }, (_, d) => (
          <button
            key={d}
            type="button"
            aria-current={d === litDot ? 'true' : undefined}
            aria-label={t('property.goToPhoto', { n: d + 1 })}
            onClick={() => showPhoto(d)}
            /* min-width, not padding: the dot width changes with state, so only a floor pins every state at
               the 24px WCAG 2.5.8 target. Exempt from the 44px sweep — 2.5.8 spacing carries it deliberately. */
            data-tap-exempt
            className="shrink-0 inline-flex min-w-[24px] items-center justify-center h-11 px-2"
          >
            <span className={'block rounded-full transition-all ' + (d === litDot ? 'w-5 h-1.5 bg-brand-teal-3' : 'w-1.5 h-1.5 bg-white/25')} />
          </button>
        ))}
        <button
          type="button"
          aria-current={ask ? 'true' : undefined}
          aria-label={t('property.requestMorePhotos')}
          onClick={() => setAsk(true)}
          /* Same rail, same 24px spacing argument as the photo dots above. */
          data-tap-exempt
          className="shrink-0 inline-flex min-w-[24px] items-center justify-center h-11 px-2"
        >
          <span className={'block w-2.5 h-2.5 rounded-full border-2 transition-all ' + (ask ? 'border-brand-teal-3 bg-brand-teal-3' : 'border-white/30')} />
        </button>
      </div>
      <HScroll wrapClassName="hidden sm:block" className="grid grid-flow-col auto-cols-[104px] sm:auto-cols-[120px] gap-3 mt-3 pb-1">
        {gallery.map((g, i) => (
          <button key={i} onClick={() => showPhoto(i)} className={'thumbnail h-20 ' + (i === active ? 'active' : '')}>
            <img src={g} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
        <button
          type="button"
          onClick={requestPhotos}
          title={t('property.requestMorePhotos')}
          className="req-photos-tile flex flex-col items-center justify-center gap-1 h-20 rounded-lg border border-dashed border-white/20 bg-white/[0.03] text-slate-400 hover:border-brand-teal-2/60 hover:text-brand-teal-3 hover:bg-brand-teal-1/5 transition-all"
        >
          <Icon name="image-plus" className="w-5 h-5" />
          <span className="text-[10px] font-semibold leading-tight text-center px-1">{t('property.morePhotos')}</span>
        </button>
      </HScroll>
    </section>
  );
}
