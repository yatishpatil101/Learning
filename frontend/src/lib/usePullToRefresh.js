import { useEffect, useRef, useState } from 'react';

/* Pull-to-refresh belongs to any touch device, not just phone layouts — which is why this
   gates on the pointer rather than on the width the way `useSwipeDismiss` does. That hook
   guards a bottom sheet, and the sheet itself only exists below 640px; a list that can be
   refreshed exists at every width, so a tablet gets the gesture too. Mouse and wheel are
   excluded for free: nothing here listens for either. */
const TOUCH = '(hover: none) and (pointer: coarse)';

const REDUCED = '(prefers-reduced-motion: reduce)';

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

/* A mock-backed refresh settles in single-digit milliseconds, which would show as a flicker
   rather than as feedback. Hold the spinner this long at minimum; the promise is still what
   ends it whenever it takes longer. */
const MIN_SPIN_MS = 350;

/**
 * Is the surface under the finger already scrolled to its top?
 *
 * That is the only state in which a downward drag means "refresh" rather than "scroll up".
 * The walk starts at the touched node so an inner scroller — the Messages conversation list,
 * a filter panel — answers for itself instead of the document answering on its behalf, and
 * falls through to the document for the pages that scroll the window.
 */
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

/**
 * Does the touched node sit inside a region that has opted out of the gesture?
 *
 * `atScrollTop` answers "is this scrolled to the top", and for a region that does not scroll at
 * all — a map, a canvas, a carousel that pans itself — the honest answer is yes, which is the
 * wrong answer: a downward drag there belongs to the region, and arming the pull would both
 * `preventDefault` the region's own gesture and fire a refetch the user never asked for. Nothing
 * about the DOM distinguishes "not scrollable, so the page scrolls" from "not scrollable, because
 * it handles the drag itself", so the region has to say so with `data-no-ptr`.
 */
function optedOut(target, root) {
  for (let n = target; n instanceof Element; n = n.parentElement) {
    if (n.hasAttribute('data-no-ptr')) return true;
    if (n === root) break;
  }
  return false;
}

/**
 * Pull-to-refresh for the app's list surfaces.
 *
 * Touch only, and only from a surface that is already at its top — anywhere else a downward
 * drag is a scroll and stays one. The hook owns the gesture and the in-flight flag; the
 * caller owns both the refetch and whatever it draws with `pullDistance` / `isRefreshing`,
 * so nothing here assumes a particular indicator.
 *
 * A gesture that is travelling more sideways than down when it crosses the slop is left alone,
 * so swipe-to-dismiss cards and horizontal chip rails inside the surface keep working. Anything
 * that handles its own drag without scrolling — a map, a canvas — has to say so with a
 * `data-no-ptr` attribute, because the DOM cannot be asked.
 *
 * Listeners are attached by hand rather than returned as React props because the one place
 * this legitimately needs `preventDefault` is `touchmove`, and React registers that one
 * passively at the root — a `preventDefault` from an `onTouchMove` prop is a no-op plus a
 * console warning. The call is also guarded on `e.cancelable`: once the browser has committed
 * to a scroll the event is no longer cancellable and cancelling it anyway is another warning.
 *
 * `prefers-reduced-motion` keeps the affordance but drops the travel: the indicator appears in
 * place once the threshold is passed instead of tracking the finger down the page.
 *
 * @param {() => (Promise<unknown> | void)} onRefresh Awaited; the gesture stays in its
 *   refreshing state until it settles, and a rejection ends it the same way a resolve does.
 * @param {{ enabled?: boolean, threshold?: number }} [options] `enabled: false` unbinds
 *   entirely — for a surface that has nothing to refetch yet.
 * @returns {{ ref: React.RefObject<HTMLElement>, pullDistance: number, progress: number,
 *   isRefreshing: boolean }} `ref` goes on the element the gesture is read from; `progress` is
 *   `pullDistance` as a 0–1 fraction of the threshold, so callers don't restate it.
 */
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

    const reduced = window.matchMedia?.(REDUCED).matches === true;
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
        /* A sideways move is somebody else's gesture — a swipe-to-dismiss card, a chip rail.
           Those travel horizontally but rarely purely so, and without this the few pixels of
           downward drift that come with any real thumb swipe would arm the pull and
           `preventDefault` the swipe out of existence. Whichever axis is winning at the moment
           the slop is crossed owns the gesture, and it is decided once: a pull that wanders
           sideways later is still a pull. */
        if (Math.abs(sideways) > Math.abs(delta)) { drag = null; return; }
        if (delta < SLOP) return;
        drag.active = true;
      }

      /* The hook's only preventDefault, and only now that the gesture is unambiguously a
         downward pull from the top: it keeps the browser's own overscroll and native
         pull-to-refresh from running underneath this one. */
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

      /* `Promise.resolve().then` rather than a bare call so a callback that throws
         synchronously ends the gesture the same way a rejected promise does — otherwise the
         spinner would be stuck on forever with nothing left to end it. */
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
      /* `alive`, `drag` and `timer` are locals of THIS effect run, but `isRefreshing` and
         `pullDistance` are React state and outlive it. If `enabled` or `threshold` changes
         between touchend and settle, the in-flight `settle` correctly declines to touch a
         torn-down instance (`if (!alive) return`) — and nothing else ever resets the state,
         so the spinner stays on screen forever. Same for a re-bind mid-drag, which strands a
         partial pull. Clearing here is the only place that can see both. */
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
