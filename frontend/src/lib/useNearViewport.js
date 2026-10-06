import { useEffect, useState } from 'react';

/* True once the element in `ref` is within `margin` of the viewport, and stays true; true at once without IntersectionObserver.
   The element must be mounted on the first render. */
export function useNearViewport(ref, margin) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    if (typeof IntersectionObserver !== 'function') { setNear(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}
