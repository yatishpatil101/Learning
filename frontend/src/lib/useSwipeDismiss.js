import { useCallback, useRef } from 'react';

const MOBILE = '(max-width: 639.98px)';

/* Past this many pixels the gesture reads as intent to dismiss rather than a
   stray drag, so releasing closes the overlay instead of snapping it back. */
const THRESHOLD = 72;

/* A vertical drag may only begin inside this strip at the top of the panel —
   the grab handle and the header. Below it the sheet's own content scrolls, and
   a drag that could mean either would make both feel unreliable. */
const HANDLE_ZONE = 40;

/* Ignore the first few pixels so a tap on a control inside the overlay is never
   swallowed by the gesture. */
const SLOP = 4;

/**
 * Drag-to-dismiss for the app's mobile overlays.
 *
 * `axis: 'y'` is the bottom-sheet gesture (drag down); `axis: 'x'` is the side
 * drawer's (drag left). Both are mobile-only — the gesture never arms unless the
 * phone media query matches — so desktop is untouched.
 *
 * Pointer capture is taken on the first qualifying *move*, never on pointerdown:
 * capturing eagerly retargets the following `click` to the panel and breaks every
 * button inside it.
 *
 * @param {() => void} onDismiss Called once a release passes the threshold.
 * @param {{ axis?: 'x' | 'y' }} [options]
 * @returns Pointer handlers to spread onto the overlay element.
 */
export default function useSwipeDismiss(onDismiss, { axis = 'y' } = {}) {
  const drag = useRef(null);

  const distance = useCallback((e) => (axis === 'y'
    ? e.clientY - drag.current.y
    : drag.current.x - e.clientX), [axis]);

  const onPointerDown = useCallback((e) => {
    if (!window.matchMedia(MOBILE).matches) return;
    if (axis === 'y' && e.clientY - e.currentTarget.getBoundingClientRect().top > HANDLE_ZONE) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false };
  }, [axis]);

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return;
    const d = distance(e);
    if (!drag.current.active) {
      if (d < SLOP) return;
      drag.current.active = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.style.transition = 'none';
    }
    e.currentTarget.style.transform = axis === 'y'
      ? `translateY(${Math.max(0, d)}px)`
      : `translateX(${Math.min(0, -d)}px)`;
  }, [axis, distance]);

  const onPointerEnd = useCallback((e) => {
    if (!drag.current) return;
    const { active } = drag.current;
    const d = distance(e);
    drag.current = null;
    if (!active) return;

    const el = e.currentTarget;
    const dismissing = d > THRESHOLD;
    /* When dismissing, hand the transform back to the stylesheet so the overlay's
       own close animation plays. Snapping back has no such animation to borrow,
       so supply one — then clear it, or the inline rule outlives the gesture and
       overrides the stylesheet's close animation on the NEXT dismissal. */
    if (dismissing) {
      el.style.transition = '';
    } else {
      el.style.transition = 'transform 200ms cubic-bezier(.32,.72,0,1)';
      el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
    }
    el.style.transform = '';
    if (dismissing) onDismiss?.();
  }, [distance, onDismiss]);

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}
