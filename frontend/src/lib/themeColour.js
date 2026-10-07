import { useSyncExternalStore } from 'react';

/* Canvas, Chart.js, Google Maps and SVG attributes cannot resolve var(), so read the live theme value at draw time, not module load;
   opaque colours come back as hex because the chart wrapper derives shades and fills from hex. */
export const cssColour = (name, alpha = 1) => {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--dz-c-${name}`).trim().split(/\s+/).map(Number);
  if (alpha === 1) return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${rgb.join(', ')}, ${alpha})`;
};

const subscribe = (onChange) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};
const isLight = () => document.documentElement.classList.contains('light');

/* Re-renders the caller when the theme flips, so anything painted with cssColour repaints. */
export const useIsLightTheme = () => useSyncExternalStore(subscribe, isLight, () => false);
