import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** How long a settled value waits for another one before it is lifted. See `COALESCE` below. */
const COALESCE_MS = 120;

/**
 * Hold a slider's in-flight value locally and lift it to the owner only when the value is committed.
 * Native-`change` reasoning, COALESCE and why not debounce: docs/system/cross-cutting.md
 */
export function useCommitOnRelease(value, onCommit) {
  const [live, setLive] = useState(null);
  const [seen, setSeen] = useState(value);
  /* A new committed value ends the gesture, whichever way it arrived. Tracking `seen` rather than
     clearing `live` survives the owner's `startTransition`; `Object.is` so NaN cannot loop. */
  if (!Object.is(seen, value)) {
    setSeen(value);
    setLive(null);
  }

  /* Kept in a ref so the listener attaches once per element and still sees the current value, and
     assigned in an effect because a ref written by a discarded transition render would go stale. */
  const commitRef = useRef(null);
  useLayoutEffect(() => {
    // `!== null` rather than a truthiness test — 0 is a legitimate slider value.
    commitRef.current = () => { if (live !== null) onCommit(live); };
  });

  const timerRef = useRef(0);
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = 0;
    commitRef.current?.();
  }, []);

  const ref = useCallback((el) => {
    if (!el) return undefined;
    const onNativeChange = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, COALESCE_MS);
    };
    el.addEventListener('change', onNativeChange);
    /* React 19 calls a callback ref's cleanup when the element detaches. Flush rather than drop:
       the control usually leaves because a section collapsed, and the value should survive that. */
    return () => { el.removeEventListener('change', onNativeChange); flush(); };
  }, [flush]);

  return [live ?? value, setLive, {
    ref,
    // A backstop for anything that moved the value and never settled it: focus leaving is the last
    // honest moment to act on it. Committing twice is harmless — the value, and the key, are equal.
    onBlur: flush,
    // `pointercancel` is the browser saying the gesture was TAKEN AWAY, not finished — usually the
    // scroller claiming a drag. Committing there would search for a value nobody chose.
    onPointerCancel: () => setLive(null),
  }];
}
