import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from './motion.js';

/* Gates on the pointer rather than on width the way `useSwipeDismiss` does: a refreshable list
   exists at every width, so a tablet gets the gesture too. */
const TOUCH = '(hover: none) and (pointer: coarse)';

/* Past this much travel the release reads as intent to refresh rather than an overscroll. */
const THRESHOLD = 64;

/* The indicator stops following the finger here, so an enthusiastic drag doesn't launch it
   down the page. */
const MAX_PULL = 96;

/* Ignore the first few pixels so a tap, or the start of an ordinary upward scroll, is never
   swallowed by the gesture. */
const SLOP = 6;

/* Finger travel is halved on the way to `pullDistance` — the drag has to feel like it is
   working against something, or the indicator arrives before the user has decided. */
const RESISTANCE = 0.5;

/* A refresh that resolves from cache settles in single-digit milliseconds, which would read as a
   flicker rather than as feedback. The promise still ends it whenever it takes longer. */
const MIN_SPIN_MS = 350;

/* Is the surface under the finger already scrolled to its top — the only state in which a downward
   drag means "refresh"? Starts at the touched node so an inner scroller answers for itself. */
function atScrollTop(target, root) {
  for (let n = target; n instanceof Element; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n.scrollTop <= 0;
    }
    if (n === root) break;
  }
  return (document.scrollingElement || document.documentElement).scrollTop <= 0;
}

/* A region that does not scroll at all — a map, a canvas, a carousel that pans itself — looks "at
   the top", and nothing in the DOM distinguishes that, so it has to say so with `data-no-ptr`. */
function optedOut(target, root) {
  for (let n = target; n instanceof Element; n = n.parentElement) {
    if (n.hasAttribute('data-no-ptr')) return true;
    if (n === root) break;
  }
  return false;
}

/* Listeners are attached by hand: the one `preventDefault` is on `touchmove`, which React registers passively,
   so an `onTouchMove` prop would be a no-op plus a console warning. */
export default function usePullToRefresh(onRefresh, { enabled = true, threshold = THRESHOLD } = {}) {
  const ref = useRef(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /* Held in a ref so an inline arrow from the caller doesn't tear down and re-bind every
     listener on every render. */
  const latest = useRef(onRefresh);
  useEffect(() => { latest.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    if (!window.matchMedia?.(TOUCH).matches) return undefined;

    const reduced = reducedMotion();
    let drag = null;
    let refreshing = false;
    let alive = true;
    let timer = null;

    const onStart = (e) => {
      drag = null;
      /* Never while one is already in flight, and never on a pinch — a second finger means
         the user is doing something else entirely. */
      if (refreshing || e.touches.length !== 1) return;
      if (optedOut(e.target, el)) return;
      if (!atScrollTop(e.target, el)) return;
      drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false, pull: 0 };
    };

    const onMove = (e) => {
      if (!drag) return;
      if (e.touches.length !== 1) { drag = null; setPullDistance(0); return; }
      const delta = e.touches[0].clientY - drag.y;
      const sideways = e.touches[0].clientX - drag.x;

      if (!drag.active) {
        /* An upward move is the user scrolling. Stand down for the rest of the gesture
           rather than waiting for them to come back past the origin. */
        if (delta < 0) { drag = null; return; }
        /* A sideways move is another gesture's (swipe-to-dismiss, chip rail); its downward drift would arm the
           pull and preventDefault the swipe. Decided once, at the slop crossing. */
        if (Math.abs(sideways) > Math.abs(delta)) { drag = null; return; }
        if (delta < SLOP) return;
        drag.active = true;
      }

      /* The hook's only preventDefault, now that the gesture is unambiguously a downward pull
         from the top: it keeps the browser's native pull-to-refresh from running underneath. */
      if (e.cancelable) e.preventDefault();

      drag.pull = Math.min(MAX_PULL, (delta - SLOP) * RESISTANCE);
      setPullDistance(reduced ? (drag.pull >= threshold ? threshold : 0) : drag.pull);
    };

    const onEnd = () => {
      const released = drag;
      drag = null;
      if (!released?.active) return;
      if (released.pull < threshold) { setPullDistance(0); return; }

      refreshing = true;
      setPullDistance(threshold);
      setIsRefreshing(true);
      const startedAt = Date.now();

      const settle = () => {
        const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
        timer = setTimeout(() => {
          refreshing = false;
          if (!alive) return;
          setIsRefreshing(false);
          setPullDistance(0);
        }, wait);
      };

      /* `Promise.resolve().then` rather than a bare call so a callback that throws synchronously
         ends the gesture the same way a rejection does, instead of stranding the spinner. */
      Promise.resolve()
        .then(() => latest.current?.())
        .then(settle, settle);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      /* The state outlives this effect run's locals, so a re-bind between touchend and settle would leave the
         spinner on forever: the in-flight `settle` declines to touch a torn-down instance. */
      setIsRefreshing(false);
      setPullDistance(0);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, threshold]);

  return {
    ref,
    pullDistance,
    progress: Math.min(1, pullDistance / threshold),
    isRefreshing,
  };
}
