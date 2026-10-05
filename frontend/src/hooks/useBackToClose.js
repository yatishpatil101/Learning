import { useEffect, useRef } from 'react';

export default function useBackToClose(open, onClose, { key = '__dzBackToClose', enabled = true, onPopClose } = {}) {
  const openRef = useRef(open);
  const closeRef = useRef(onClose);
  const popCloseRef = useRef(onPopClose);
  const pushedRef = useRef(false);
  const closingByPopRef = useRef(false);
  const cleanupBackRef = useRef(false);
  const tokenRef = useRef('');

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { popCloseRef.current = onPopClose; }, [onPopClose]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const token = window.history.state?.[key];
    if (!token) return;
    tokenRef.current = token;
    pushedRef.current = true;
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const onPop = (event) => {
      if (!openRef.current || !pushedRef.current || cleanupBackRef.current) return;
      if (event.state?.[key] === tokenRef.current) return;
      pushedRef.current = false;
      closingByPopRef.current = true;
      popCloseRef.current?.();
      closeRef.current?.();
      setTimeout(() => { closingByPopRef.current = false; }, 0);
    };
    window.addEventListener('popstate', onPop, { capture: true });
    return () => window.removeEventListener('popstate', onPop, { capture: true });
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (!open) {
      if (pushedRef.current && !closingByPopRef.current) {
        const state = window.history.state || {};
        pushedRef.current = false;
        if (state[key] === tokenRef.current) {
          cleanupBackRef.current = true;
          window.history.back();
          setTimeout(() => { cleanupBackRef.current = false; }, 0);
        }
      }
      return;
    }

    if (!tokenRef.current) tokenRef.current = `${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const state = window.history.state || {};
    if (pushedRef.current) {
      if (state[key] !== tokenRef.current) {
        window.history.replaceState({ ...state, [key]: tokenRef.current }, '', window.location.href);
      }
      return;
    }
    window.history.pushState({ ...state, [key]: tokenRef.current }, '', window.location.href);
    pushedRef.current = true;
  });
}
