import { useEffect, useRef } from 'react';
import isTopDialog from '../lib/isTopDialog.js';

/* The keyboard half of `aria-modal="true"` — Escape, a Tab trap, focus in and back out. Without
   them the attribute strands a screen-reader user in a dialog their focus is not in. Pair with
   `useScrollLock`; the panel this ref lands on needs `tabIndex={-1}` for the initial focus. */
export default function useModalDialog(open, onClose) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // Only the topmost dialog answers, so Escape closes the sheet on top rather than the page
      // behind it — and a stacked dialog does not steal the key from the one the user is in.
      if (!isTopDialog(panelRef.current)) return;
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    /* Most callers pass an inline `onClose`, so this effect re-runs on every keystroke — hence
       claiming focus only when it is not already in the panel. */
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Its own effect, keyed only on `open`: the effect above also re-runs whenever `onClose` changes
     identity, and restoring focus there would eject the user from a dialog that is still open. */
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    return () => {
      // A trigger whose dialog navigated away is gone from the document; focusing it would take
      // focus off the page the user just arrived at.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  return panelRef;
}
