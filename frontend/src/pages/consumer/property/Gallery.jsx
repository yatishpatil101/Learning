import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';

export function Gallery({ gallery, active, setActive, title, p, flagEnabled, setLightbox, setTourOpen, requestPhotos }) {
  const { t } = useTranslation();
  const count = gallery.length;
  const go = (dir) => setActive((i) => (i + dir + count) % count);
  // Swipe navigation for touch devices (mobile): a horizontal drag flips photos.
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.changedTouches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null || count < 2) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };
  return (
    <section className="fade-in mb-6 sm:mb-10">
      <div className="relative main-image-wrapper rounded-2xl overflow-hidden" style={{ maxHeight: 400 }}>
        <img src={gallery[active]} alt={title} onClick={() => setLightbox(true)} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="w-full h-[230px] sm:h-[320px] lg:h-[360px] object-cover cursor-zoom-in" style={{ viewTransitionName: `property-hero-${p.id}` }} />
        {count > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t('property.prevPhoto')} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white flex items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-left" className="w-5 h-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label={t('property.nextPhoto')} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full glass-strong text-white flex items-center justify-center hover:bg-white/15 transition-smooth"><Icon name="chevron-right" className="w-5 h-5" /></button>
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
      </div>
      {/* Mobile keeps the swipeable hero (arrows + counter) but drops the redundant
          thumbnail strip to save vertical space — the "Request more photos" action is
          preserved as a compact inline button so that entry point isn't lost. */}
      <button
        type="button"
        onClick={requestPhotos}
        className="sm:hidden mt-2.5 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/20 bg-white/[0.03] text-slate-400 text-xs font-semibold hover:border-brand-teal-2/60 hover:text-brand-teal-3 hover:bg-brand-teal-1/5 transition-all"
      >
        <Icon name="image-plus" className="w-4 h-4" /> {t('property.requestMorePhotos')}
      </button>
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
