import { useEffect, useState } from 'react';

/* Same breakpoint the shared <Modal> uses to switch from a centred dialog to a
   bottom sheet, so every overlay in the app flips presentation at one width. */
const SHEET = '(max-width: 639.98px)';

/**
 * True while the viewport is phone-sized, i.e. while overlays should present as
 * bottom sheets rather than anchored/centred desktop panels.
 *
 * Portaled dropdowns anchor themselves with imperative inline styles, so they
 * need this as a *value* (to skip anchoring and clear those styles) rather than
 * as a CSS media query alone.
 *
 * @returns {boolean}
 */
export default function useSheetViewport() {
  const [sheet, setSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(SHEET).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(SHEET);
    const onChange = (e) => setSheet(e.matches);
    mq.addEventListener('change', onChange);
    setSheet(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return sheet;
}
