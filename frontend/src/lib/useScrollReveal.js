import { useEffect, useRef } from 'react';

/* Ports initScrollReveal: adds `.visible` to `.reveal` elements as they enter the viewport.
   Also watches for async-rendered reveal content (e.g. sections that appear after a fetch
   resolves) via a MutationObserver, so late-mounted `.reveal` nodes still animate in. */
export function useScrollReveal(deps = []) {
  const rootRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current || document;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    const observe = (el) => {
      if (!el.classList.contains('visible')) io.observe(el);
    };
    const scan = (node) => {
      if (node.nodeType !== 1) return;
      if (node.matches('.reveal, .fade-up, .fade-in')) observe(node);
      node.querySelectorAll('.reveal, .fade-up, .fade-in').forEach(observe);
    };

    root.querySelectorAll('.reveal, .fade-up, .fade-in').forEach(observe);

    // Catch reveal content that mounts after this effect runs (async data, conditional sections).
    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => m.addedNodes.forEach(scan));
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return rootRef;
}
