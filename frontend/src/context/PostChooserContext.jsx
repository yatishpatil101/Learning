import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import PostChooser from '../components/PostChooser.jsx';

/* One posting sheet for the whole consumer shell, mounted once here so every posting control opens
   the same instance. The provider holds nothing but "is it open" — docs/system/cross-cutting.md. */

const PostChooserContext = createContext(null);
/* Split from the action on purpose: `openPostChooser` never changes, so consumers that only open
   the sheet never re-render. Folding the two together would re-render the board underneath it. */
const PostChooserOpenContext = createContext(false);

export function usePostChooser() {
  const ctx = useContext(PostChooserContext);
  // Loud rather than a no-op: a Post button that silently does nothing is the
  // kind of failure that ships.
  if (!ctx) throw new Error('usePostChooser() must be used inside <PostChooserProvider>');
  return ctx;
}

/** Whether the sheet is open. For a trigger that stays on screen and must report its own state. */
export function usePostChooserOpen() {
  return useContext(PostChooserOpenContext);
}

export function PostChooserProvider({ children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Stable identity: `openPostChooser` is read by useFlatmates and passed down
  // through several memoised layers of the Flatmates board.
  const value = useMemo(() => ({ openPostChooser: () => setOpen(true) }), []);

  return (
    <PostChooserContext.Provider value={value}>
      <PostChooserOpenContext.Provider value={open}>
        {children}
        <PostChooser open={open} onClose={close} />
      </PostChooserOpenContext.Provider>
    </PostChooserContext.Provider>
  );
}
