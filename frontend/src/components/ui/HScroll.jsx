import { useCallback, useEffect, useRef, useState } from 'react';
import { classNames } from '../../lib/format.js';

/* Horizontal scroll row with an edge-fade affordance.
   Mobile/tablet are touch-based, so the user swipes directly; the gradient fade
   on each side signals "there's more to scroll here" — the same clean melt used by
   the home "Explore by property type" rail. Set `fadeColor` to the immediate
   container's background so the fade melts into it (rather than reading as a shadow).

   Props:
   - className     -> passed to the inner scrolling row (its flex/grid/gap/padding).
   - wrapClassName -> passed to the outer positioned wrapper (use for -mx bleed).
   - fadeColor     -> gradient colour, default the page background so cards melt out.
   - fadeWidth     -> width of each fade band.
   - scrollRef     -> optional external ref to the scrolling element.
   - ...rest       -> forwarded to the row (role="tablist", aria-label, style, etc). */
export default function HScroll({
  children,
  className = '',
  wrapClassName = '',
  fadeColor = 'var(--brand-dark)',
  fadeWidth = '1.75rem',
  scrollRef: externalRef,
  onClick: onClickProp,
  ...rest
}) {
  const innerRef = useRef(null);
  const ref = externalRef || innerRef;
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setFadeLeft(scrollLeft > 4);
    setFadeRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, [ref]);

  // Smart scroll: bring a clipped item fully into view. When a control near the
  // edge is tapped (e.g. a half-hidden tab), nudge the strip so the whole item is
  // visible with a little breathing room — nothing moves if it's already in view.
  const revealChild = useCallback((child) => {
    const el = ref.current;
    if (!el || !child || !el.contains(child)) return;
    const pad = 20;
    const er = el.getBoundingClientRect();
    const cr = child.getBoundingClientRect();
    let delta = 0;
    if (cr.left < er.left + pad) delta = cr.left - er.left - pad;
    else if (cr.right > er.right - pad) delta = cr.right - er.right + pad;
    if (Math.abs(delta) > 1) el.scrollBy({ left: delta, behavior: 'smooth' });
  }, [ref]);

  const handleClick = useCallback((e) => {
    onClickProp?.(e);
    const target = e.target.closest('button, a, [role="tab"]');
    if (target && ref.current?.contains(target)) {
      // Defer a frame so any active-state width change settles before we measure.
      requestAnimationFrame(() => revealChild(target));
    }
  }, [onClickProp, revealChild, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      el.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [update, ref]);

  // Recompute when children/content change without an element resize (e.g. a new
  // filter set) — cheap, only flips state when an edge actually gains/loses clip.
  useEffect(() => { update(); });

  return (
    <div className={classNames('relative', wrapClassName)}>
      <div ref={ref} onClick={handleClick} className={classNames('overflow-x-auto no-scrollbar', className)} {...rest}>
        {children}
      </div>
      <div
        className="hscroll-fade hscroll-fade--left"
        aria-hidden="true"
        style={{ width: fadeWidth, background: `linear-gradient(to right, ${fadeColor}, transparent)`, opacity: fadeLeft ? 1 : 0 }}
      />
      <div
        className="hscroll-fade hscroll-fade--right"
        aria-hidden="true"
        style={{ width: fadeWidth, background: `linear-gradient(to left, ${fadeColor}, transparent)`, opacity: fadeRight ? 1 : 0 }}
      />
    </div>
  );
}
