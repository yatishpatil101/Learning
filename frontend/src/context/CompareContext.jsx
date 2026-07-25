import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const CompareContext = createContext(null);
const KEY = 'puneNestCompare';

export function CompareProvider({ children }) {
  const [ids, setIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  });

  const persist = useCallback((next) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    setIds(next);
  }, []);

  const toggle = useCallback(
    (id) =>
      setIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 4);
        localStorage.setItem(KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const has = useCallback((id) => ids.includes(id), [ids]);
  const value = useMemo(() => ({ ids, count: ids.length, toggle, clear, has }), [ids, toggle, clear, has]);
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare() {
  return useContext(CompareContext);
}
