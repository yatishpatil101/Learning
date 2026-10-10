import { getAppPrefs } from './localPrefs.js';

export const reducedMotion = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true || !!getAppPrefs().reduceMotion;
  } catch {
    return false;
  }
};

const demote = (arg) => (arg && typeof arg === 'object' && arg.behavior === 'smooth' && reducedMotion() ? { ...arg, behavior: 'auto' } : arg);

let installed = false;

/* Script `behavior: 'smooth'` ignores the OS setting and our own toggle, so each call site would need a check. */
export function installReducedMotionScroll() {
  if (installed) return;
  installed = true;
  const wrap = (proto, name) => {
    const native = proto[name];
    if (typeof native !== 'function') return;
    proto[name] = function patched(arg, ...rest) { return native.call(this, demote(arg), ...rest); };
  };
  [window, Element.prototype].forEach((proto) => ['scrollTo', 'scrollBy'].forEach((n) => wrap(proto, n)));
  wrap(Element.prototype, 'scrollIntoView');
}
