/* Shared deterministic helpers for the analytics slices, mirrored from the
   HTML app's admin-data.js. Kept internal to the analytics module (not
   re-exported from the barrel). */
export { rawDb } from '../../mockApi.js';

// ---- deterministic helpers (identical to admin-data.js) ----
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}
export function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
