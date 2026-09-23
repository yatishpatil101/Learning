import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CITY, getCities, getCityLive, onGeoChange } from '../lib/geoConfig.js';
import { joinCityWaitlist } from '../services/cityService.js';

/* Which cities are live comes from the curated roster (`GET /cities`, Pune-only when unreachable)
   read live via lib/geoConfig.js; a non-live city opens the waitlist instead of switching. */
const CityContext = createContext(null);
const CKEY = 'draazyCity';

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
    /* `onGeoChange` fires when lib/geoConfig.js finishes fetching `GET /geo`; until then the roster
       is the built-in defaults, so without it a second live city renders as "coming soon". */
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

  // Kick the shopper back to the default city when the one they are viewing is taken offline. The
  // previous {city, live} is remembered so this reacts only to a toggle, not to a deliberate switch.
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
    /* Throw rather than return: a silent resolve would toast "you're on the list" for a request
       that never left the browser. Unreachable today, which is why it has to be loud. */
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
