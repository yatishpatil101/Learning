import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { srcSetFor } from '../../../lib/imgSrcSet.js';

export function Gallery({ gallery, active, setActive, title, p, flagEnabled, setLightbox, setTourOpen, requestPhotos, priceStr }) {
  const { t } = useTranslation();
  const count = gallery.length;
  const go = (dir) => setActive((i) => (i + dir + count) % count);
  /* Mobile only: the photo-request ask is the LAST SLIDE of the carousel rather than a
     control parked underneath it. A buyer who has swiped to the end of the photos is
     exactly the buyer who wants more of them, so the ask lands at the moment of interest
     instead of competing for space with the dot rail. Desktop is untouched — it still has
     the dashed thumbnail tile at the end of the strip, which is the same idea with room
     to spare. Kept as local state, not folded into `active`, because `active` also indexes
     the lightbox and the desktop thumbnails: a count-th value would read `gallery[count]`
     as undefined there. */
  const [ask, setAsk] = useState(false);
  // Swipe navigation for touch devices (mobile): a horizontal drag flips slides.
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.changedTouches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) <= 40) return;
    const dir = dx < 0 ? 1 : -1;
    // The ask is a terminus: you can only swipe back out of it, never past it.
    if (ask) { if (dir < 0) setAsk(false); return; }
    if (dir > 0 && active === count - 1) { setAsk(true); return; }
    go(dir);
  };
  const showPhoto = (i) => { setAsk(false); setActive(i); };
  return (
    <section className="fade-in mb-6 sm:mb-10">
      {/* Photos are the #1 trust signal in an Indian listing. On a phone the old
          230px letterbox read as a thumbnail; a full-bleed 4:3 hero gives them the
          weight they deserve. Both the bleed (-mx-4) and the aspect ratio are reset
          at sm:, so tablet and desktop keep today's fixed-height, inset card.
          Touch handlers sit on the wrapper, not the <img>, so the ask slide painted
          over it is swipeable too. */}
      <div className="relative main-image-wrapper -mx-4 sm:mx-0 rounded-none sm:rounded-2xl overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ maxHeight: 400 }}>
        <img src={gallery[active]} srcSet={srcSetFor(gallery[active])} sizes="(max-width: 639px) 100vw, 60vw" fetchPriority="high" alt={title} onClick={() => setLightbox(true)} className="w-full aspect-[4/3] h-auto sm:aspect-auto sm:h-[320px] lg:h-[360px] object-cover cursor-zoom-in" style={{ viewTransitionName: `property-hero-${p.id}` }} />
        {count > 1 ? (
          <>
            {/* Arrows are redundant next to a working swipe on touch, and they cover
                the photo. Hidden below sm:; the dot rail below is the touch affordance. */}
            <button type="button" onClick={() => go(-1)} aria-label={t('property.prevPhoto')} className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-left" className="w-5 h-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label={t('property.nextPhoto')} className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-right" className="w-5 h-5" /></button>
          </>
        ) : null}
        {flagEnabled('videoListings') && (
        <button type="button" onClick={() => setTourOpen(true)} className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 rounded-full glass-strong text-white text-sm font-semibold hover:bg-white/15 transition-smooth">
          <Icon name="video" className="w-4 h-4 text-brand-teal-3" /> {t('property.virtualTour')}
        </button>
        )}
        <button type="button" onClick={() => setLightbox(true)} className="absolute top-4 right-4 flex items-center gap-2 px-3.5 py-2 rounded-full glass-strong text-white text-sm font-semibold hover:bg-white/15 transition-smooth">
          <Icon name="expand" className="w-4 h-4" /> <span className="hidden sm:inline">{t('property.fullscreen')}</span>
        </button>
        <div className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-full glass-strong text-white text-sm font-semibold">
          <Icon name="camera" className="w-4 h-4" /> <span>{active + 1}/{gallery.length}</span>
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
        {/* The ask slide. Covers the hero (and its badges) rather than sitting in flow, so
            it inherits the hero's exact box — swiping between a photo and the ask stays a
            single steady frame instead of the page reflowing under the finger. */}
        {ask ? (
          <div data-photo-ask="" className="sm:hidden absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center bg-ink-2">
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
        ) : null}
      </div>
      {/* Dot rail: replaces the desktop thumbnail strip on phones. Centred, because it is
          now the only thing on its line — it answers "how many photos are there?" and keeps
          tapping as an alternative to swiping. Photo dots are capped at 6 so a 30-photo
          listing doesn't smear into a hairline (the counter on the photo carries the exact
          number); the trailing dot is the ask slide, drawn as a ring so it reads as "a
          different kind of thing" rather than photo #7. Each dot is a 24x44 box: the WCAG
          2.5.8 floor, with centres far enough apart that neighbours can't steal taps.

          `-mb-6` cancels the section's own `mb-6`: the rail's 44px touch box is a hit area,
          not spacing, and letting it stack on top of the section gap painted ~73px of dead
          air between the photo and the badges. Cancelling one against the other leaves the
          dot sitting 19px clear on both sides — symmetric, targets untouched, and the two
          boxes meet exactly rather than overlapping (an overlap would let the badges row
          swallow taps aimed at the bottom of a dot). Mobile-only; `sm:mb-0` restores the
          desktop rhythm, where this rail is hidden anyway. */}
      <div data-gallery-dots="" className="sm:hidden flex items-center justify-center -mb-6 sm:mb-0" role="tablist" aria-label={t('property.photoDotsAria')}>
        {gallery.slice(0, 6).map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={!ask && i === active}
            aria-label={t('property.goToPhoto', { n: i + 1 })}
            onClick={() => showPhoto(i)}
            /* min-w-[24px], not padding alone: `px-2` (8px a side) around a `w-1.5`
               (6px) dot measures 22px, two short of the 24px WCAG 2.5.8 floor this
               rail is documented to meet — while the *active* dot is `w-5` and
               measures 36px. Padding cannot fix both at once because the dot width
               changes with state. A min-width pins the floor for every state and
               leaves the active pill alone. */
            className="shrink-0 inline-flex min-w-[24px] items-center justify-center h-11 px-2"
          >
            <span className={'block rounded-full transition-all ' + (!ask && i === active ? 'w-5 h-1.5 bg-brand-teal-3' : 'w-1.5 h-1.5 bg-white/25')} />
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={ask}
          aria-label={t('property.requestMorePhotos')}
          onClick={() => setAsk(true)}
          className="shrink-0 inline-flex min-w-[24px] items-center justify-center h-11 px-2"
        >
          <span className={'block w-2.5 h-2.5 rounded-full border-2 transition-all ' + (ask ? 'border-brand-teal-3 bg-brand-teal-3' : 'border-white/30')} />
        </button>
      </div>
      <HScroll wrapClassName="hidden sm:block" className="grid grid-flow-col auto-cols-[104px] sm:auto-cols-[120px] gap-3 mt-3 pb-1">
        {gallery.map((g, i) => (
          <button key={i} onClick={() => setActive(i)} className={'thumbnail h-20 ' + (i === active ? 'active' : '')}>
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
