import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CITY, getCities, getCityLive } from '../lib/geoConfig.js';
import { syncGeoFromDisk } from '../lib/mockApi.js';

/* PuneNest city system (ports PNCity from auth.js). City is persisted in
   `puneNestCity`; which cities are live is governed by the admin Maps settings
   (settings.geo.cities[name].live, defaulting to Pune-only), read live via
   lib/geoConfig.js. Non-live cities are "coming soon" and route demand into
   `pnCityRequests` (same shape the back-office reads). Selecting a non-live city
   opens the waitlist modal and shows the bottom waitlist banner. */
const CityContext = createContext(null);
const CKEY = 'puneNestCity';
const RKEY = 'pnCityRequests';

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
    // Cross-browser/profile: admin edits live in a shared on-disk store; pull the latest
    // geo policy in on mount and whenever this tab regains focus so a city going live in
    // the admin portal reaches shoppers here without a manual cache clear. syncGeoFromDisk
    // fires punenest-settings-change on a real change, which `sync` picks up; it's a no-op
    // in production/tests and when nothing changed.
    const pull = () => { syncGeoFromDisk().catch(() => {}); };
    window.addEventListener('punenest-settings-change', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', pull);
    pull();
    return () => {
      window.removeEventListener('punenest-settings-change', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', pull);
    };
  }, []);

  const isLive = useCallback(
    (name) => cities.find((c) => c.name.toLowerCase() === (name || '').toString().toLowerCase())?.live ?? false,
    [cities],
  );

  const setCity = useCallback((next) => {
    const name = String(next || '').trim();
    if (!name) return;
    try {
      localStorage.setItem(CKEY, name);
    } catch {
      /* ignore */
    }
    setCityState(name);
    if (!getCityLive(name)) setModal({ type: 'waitlist', city: name });
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

  const requestCity = useCallback((o) => {
    const cityName = String(o?.city || '').trim();
    if (!cityName) return;
    let arr = [];
    try {
      arr = JSON.parse(localStorage.getItem(RKEY)) || [];
    } catch {
      arr = [];
    }
    const who = String(o.mobile || o.email || '').trim().toLowerCase();
    const key = who ? `${who}|${cityName.toLowerCase()}` : '';
    const existing = who ? arr.find((x) => x.who === key) : null;
    if (existing) {
      existing.at = Date.now();
      existing.name = o.name || existing.name;
      existing.mobile = o.mobile || existing.mobile;
      existing.email = o.email || existing.email;
    } else {
      arr.unshift({
        id: 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        who: who ? key : '',
        city: cityName,
        name: String(o.name || '').trim(),
        mobile: String(o.mobile || '').trim(),
        email: String(o.email || '').trim(),
        at: Date.now(),
      });
    }
    try {
      localStorage.setItem(RKEY, JSON.stringify(arr));
    } catch {
      /* ignore */
    }
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
