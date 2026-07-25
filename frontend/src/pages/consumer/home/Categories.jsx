import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { CATEGORIES } from '../../../data/homeData.js';

export default function Categories({ navigate }) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  // Reflect the strip's scroll position in the arrow enabled-state and the
  // edge fades. Arrows track whether there is more to scroll; the fades track
  // whether a card is actually clipped by that edge, so a card sitting flush
  // (fully visible) never gets a fade over it.
  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanPrev(scrollLeft > 4);
    setCanNext(scrollLeft < scrollWidth - clientWidth - 4);

    const stripLeft = el.getBoundingClientRect().left;
    const TH = 8; // ignore sub-pixel / near-aligned cards
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

  // Advance ~80% of the visible width so a near-full page of tiles moves while
  // one partial card stays visible as an anchor.
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
      className="grid place-items-center w-9 h-9 rounded-full glass border border-white/10 text-gray-200 transition-all hover:border-teal-400/40 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10 disabled:hover:text-gray-200"
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );

  return (
    <section className="relative section-y">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* heading — left-aligned, paired with the scroll arrows + "view all" */}
        <div className="flex items-end justify-between gap-3 mb-3 reveal">
          <div className="min-w-0">
            <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-1.5">{t('home.categories.eyebrow')}</p>
            <h2 className="text-2xl sm:text-3xl font-bold">{t('home.categories.title')}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {arrowBtn(-1, t('home.categories.prevAria'), 'chevron-left', canPrev)}
            {arrowBtn(1, t('home.categories.nextAria'), 'chevron-right', canNext)}
            <button onClick={() => navigate('/listings')} className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-teal-400 hover:text-teal-300 transition-colors group">
              {t('home.categories.allListings')} <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>

        {/* horizontal scroll strip — pt-3 gives the hover lift (-8px) clip room,
           since overflow-x-auto also clips vertical overflow. The arrows above
           and the right-edge fade both signal there is more to scroll. */}
        <div className="relative -mx-4 sm:-mx-6 lg:mx-0">
          <div ref={scrollRef} className="cat-scroll flex gap-3 overflow-x-auto pt-3 pb-3 px-4 sm:px-6 lg:px-0 scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 reveal" style={{ scrollSnapType: 'x mandatory' }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.title}
                onClick={() => navigate(c.href)}
                className="cat-card flex-shrink-0 glass rounded-2xl cursor-pointer group flex items-center gap-4 px-5 py-4 hover:border-white/15 transition-all duration-300"
                style={{ scrollSnapAlign: 'start', minWidth: '200px' }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${c.color}18` }}
                >
                  <Icon name={c.icon} className="w-6 h-6" style={{ color: c.color }} />
                </div>
                <div className="text-left min-w-0">
                  <p className="font-semibold text-sm text-white leading-tight">{c.title}</p>
                  <p className="text-xs mt-0.5 tabular-nums" style={{ color: c.color }}>{c.count} {t('home.categories.properties')}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="cat-fade cat-fade--left" aria-hidden="true" style={{ opacity: fadeLeft ? 1 : 0, transition: 'opacity .3s ease' }} />
          <div className="cat-fade cat-fade--right" aria-hidden="true" style={{ opacity: fadeRight ? 1 : 0, transition: 'opacity .3s ease' }} />
        </div>
      </div>
    </section>
  );
}
