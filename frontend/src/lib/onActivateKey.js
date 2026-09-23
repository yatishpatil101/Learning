/* Enter/Space activation for a control built out of a `div`. Shared rather than copied because
   the repeat guard is the part everyone forgets: a native button fires Space on keyup and does
   not re-fire while the key is held, so a keydown handler without it toggles at the OS repeat
   rate and lands on whichever state the release happens to fall on. */
export const onActivateKey = (fn) => (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); // ahead of the guard, or a held Space still pages the document
  if (e.repeat) return;
  fn?.(e);
};
