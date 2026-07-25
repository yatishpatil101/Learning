import { useSearchParams } from 'react-router';

/* URL-synced tab state — mirrors the Analytics module pattern.
   The active tab lives in the `?tab=` search param, so every tab is a
   separately navigable, shareable URL. Returns [tab, setTab] where
   `tab` is always one of `validKeys` (falls back to `defaultKey`). */
export function useTabParam(validKeys, defaultKey) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const tab = validKeys.includes(raw) ? raw : (defaultKey ?? validKeys[0]);
  const setTab = (key) => setSearchParams({ tab: key }, { replace: true });
  return [tab, setTab];
}
