import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CITY, getCities, getCityLive, onGeoChange } from '../lib/geoConfig.js';
import { joinCityWaitlist } from '../services/cityService.js';

/* Draazy city system (ports PNCity from auth.js). City is persisted in
   `draazyCity`; which cities are live is governed by the curated city roster
   (`GET /cities`, defaulting to Pune-only when unreachable), read live via
   lib/geoConfig.js. Non-live cities are "coming soon" and route demand into
   `POST /cities/waitlist`. Selecting a non-live city opens the waitlist modal
   and shows the bottom waitlist banner. */
const CityContext = createContext(null);
const CKEY = 'draazyCity';

// Live status is resolved from admin settings; `isCityLive` stays exported for
// back-compat but now delegates to the single source of truth.
export const isCityLive = (name) => getCityLive(name);

export function CityProvider({ children }) {
  const [city, setCityState] = useState(() => {
    try {
      return localStorage.getItem(CKEY) || 'Pune';
    } catch {
      return 'Pune';
    }
  });
  const [modal, setModal] = useState(null); // { type: 'waitlist' | 'request', city }
  // City roster + live status, re-read whenever an admin saves the Maps settings.
  const [cities, setCities] = useState(getCities);

  useEffect(() => {
    const sync = () => setCities(getCities());
    /* Three sources, and the first is the one that made the other two mean anything.

       `onGeoChange` fires when `lib/geoConfig.js` finishes fetching the operator's policy from
       `GET /geo`. Until that lands the roster is built from the built-in defaults — Pune live,
       everything else waitlisted — so without this subscription a second live city would render
       as "coming soon" until something else happened to trigger a re-render.

       Before that route existed, a `focus` listener sat here calling `syncGeoFromDisk()` from
       `mockApi.js`, with a comment promising it would carry an admin's city-went-live edit "to
       shoppers here without a manual cache clear". It never could: `syncGeoFromDisk` began by
       awaiting `persistLoad(KEY)`, which returns `null` whenever `DISK_OFF`
       (`!import.meta.env.DEV || navigator.webdriver`) — so it returned `false` on its first line
       in every production build and under every Playwright run. Its entire reachable behaviour
       was that a second browser profile on a developer's own machine picked up a geo edit on
       focus. The workaround is gone and so is the staleness it was covering for.

       The other two still fire and still matter: `draazy-settings-change` is dispatched by
       `updateSettings` (and re-fetches the policy, see main.jsx), and `storage` by another tab in
       the same profile. */
    const unsubscribe = onGeoChange(sync);
    window.addEventListener('draazy-settings-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      unsubscribe();
      window.removeEventListener('draazy-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const isLive = useCallback(
    (name) => cities.find((c) => c.name.toLowerCase() === (name || '').toString().toLowerCase())?.live ?? false,
    [cities],
  );

  const setCity = useCallback((next) => {
    const name = String(next || '').trim();
    if (!name) return;
    // A "coming soon" city is a waitlist prompt, not a destination: only open the
    // modal and leave the shopper on their current city, so cancelling is a no-op.
    if (!getCityLive(name)) {
      setModal({ type: 'waitlist', city: name });
      return;
    }
    try {
      localStorage.setItem(CKEY, name);
    } catch {
      /* ignore */
    }
    setCityState(name);
  }, []);

  // If the city the shopper is currently viewing gets taken offline by an admin
  // (live -> not-live for that same city), kick them back to the default live city so
  // they can't keep browsing a city that's no longer launched. We remember the previous
  // {city, live} so this only reacts to an actual toggle of the current city — not to
  // deliberately switching to a "coming soon" city (which shows the waitlist and stays put).
  const prevRef = useRef({ name: city, live: isLive(city) });
  useEffect(() => {
    const nowLive = isLive(city);
    const prev = prevRef.current;
    prevRef.current = { name: city, live: nowLive };
    if (prev.name === city && prev.live && !nowLive && city !== DEFAULT_CITY) {
      setCity(DEFAULT_CITY);
    }
  }, [cities, city, isLive, setCity]);

  const openWaitlist = useCallback((c) => setModal({ type: 'waitlist', city: c || city }), [city]);
  const openRequest = useCallback(() => setModal({ type: 'request', city: '' }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const requestCity = useCallback(async (o) => {
    const cityName = String(o?.city || '').trim();
    /* Throw rather than return. A silent resolve is indistinguishable from a delivered ask, so the
       caller would toast "you're on the list" for a request that never left the browser — the exact
       failure this whole migration was about. Unreachable today (both modal branches guard a
       non-empty city), which is why it has to be loud if it ever becomes reachable. */
    if (!cityName) throw new Error('requestCity: a city is required');
    await joinCityWaitlist({
      city: cityName,
      mobile: String(o.mobile || '').trim(),
      email: String(o.email || '').trim(),
    });
  }, []);

  const value = useMemo(
    () => ({ city, setCity, isLive, cities, modal, openWaitlist, openRequest, closeModal, requestCity }),
    [city, setCity, isLive, cities, modal, openWaitlist, openRequest, closeModal, requestCity],
  );

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity() {
  return useContext(CityContext);
}
