import { useEffect } from 'react';

export default function useVisualViewportInsets(active) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return undefined;
    const root = document.documentElement.style;
    const sync = () => {
      root.setProperty('--dz-vv-top', `${vv.offsetTop}px`);
      root.setProperty('--dz-vv-bottom', `${Math.max(0, window.innerHeight - vv.offsetTop - vv.height)}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      root.removeProperty('--dz-vv-top');
      root.removeProperty('--dz-vv-bottom');
    };
  }, [active]);
}
