import { useCallback, useRef } from 'react';

const MOBILE = '(max-width: 639.98px)';

/* Past this many pixels the gesture reads as intent to dismiss rather than a
   stray drag, so releasing closes the overlay; below it, the panel snaps back. */
const THRESHOLD = 72;

/* A vertical drag may only begin inside this strip at the top of the panel (handle + header);
   below it the sheet's own content scrolls, and an ambiguous drag would make both feel unreliable. */
const HANDLE_ZONE = 40;

/* Ignore the first few pixels so a tap on a control inside the overlay is never
   swallowed by the gesture. */
const SLOP = 4;

/* Controls that interpret a drag themselves: a range thumb *is* a drag handle, so a pointerdown on
   one is never "dismiss". Matched on the target so the gesture never arms rather than racing. */
const DRAG_HANDLES = 'input[type="range"]';

/**
 * Drag-to-dismiss for the app's mobile overlays (`'y'` bottom sheet, `'x'` side drawer). Pointer
 * capture waits for the first qualifying *move*: on pointerdown it would break every button inside.
 */
export default function useSwipeDismiss(onDismiss, { axis = 'y' } = {}) {
  const drag = useRef(null);

  const distance = useCallback((e) => (axis === 'y'
    ? e.clientY - drag.current.y
    : drag.current.x - e.clientX), [axis]);

  const onPointerDown = useCallback((e) => {
    if (!window.matchMedia(MOBILE).matches) return;
    if (e.target?.closest?.(DRAG_HANDLES)) return;
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
    /* Dismissing hands the transform back to the stylesheet so the overlay's own close animation
       plays; a snap-back has none to borrow, so supply one and clear it after. */
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
