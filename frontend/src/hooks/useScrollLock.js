import { useEffect } from 'react';

/* Hold the page still behind an open overlay, applied to the ROOT element: `body`'s overflow only
   propagates to the viewport while the root's own is `visible`, and `styles/index.css` sets
   `overflow-x: clip` on html, so the familiar body idiom is a no-op here.

   Reference-counted because overlays nest; this hook is the only writer of the root's inline
   overflow, since a second one would poison the single saved value. */
let depth = 0;
let restore = '';

export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    if (depth === 0) {
      /* `overflowY`, not the `overflow` shorthand: the shorthand would replace the stylesheet's
         `overflow-x: clip` with `hidden`, making the root a scroll container on an axis that is
         meant never to scroll. */
      restore = root.style.overflowY;
      root.style.overflowY = 'hidden';
    }
    depth += 1;
    return () => {
      /* Clamped: under Fast Refresh this module re-evaluates and resets the count while an overlay
         still holds a lock, and a negative depth would wedge the page unscrollable. */
      depth = Math.max(0, depth - 1);
      if (depth === 0) root.style.overflowY = restore;
    };
  }, [active]);
}
