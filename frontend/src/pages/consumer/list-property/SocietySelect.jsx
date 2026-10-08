import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, MapPin, MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mintSociety, resolveSociety } from '../../../services/societyService.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { fetchSuggestions, fetchPlaceDetails, newAutocompleteSession } from '../../../lib/places.js';
import { haversineKm } from '../../../lib/listings/coords.js';
import { cleanText } from './sanitize.js';
import { fld } from './styles.js';

const GOOGLE_LIMIT = 5;
const GOOGLE_BIAS_RADIUS_M = 3000;
const GOOGLE_TYPES = ['establishment', 'premise'];

const distanceLabel = (km) => (km < 1
  ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  : `${km.toFixed(1)} km`);

/** A society is only chosen from a Google Maps suggestion, resolved or minted server-side; typed text is never emitted as one.
 * `onChange` gets the bound society, `{ notOnMaps: true, source: 'notOnMaps' }`, or `null` once the owner types over a binding. */
export default function SocietySelect({
  value, name, notOnMaps = false, allowNotOnMaps = true, onChange,
  localityLabel = '', lat = null, lng = null,
  placeholder, invalid = false, dataErr = 'society', inputClassName = fld, id,
  mintOrigin = 'listing', authReason = 'listproperty', onRequireAuth,
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const signIn = useSignInGate();
  const [query, setQuery] = useState(name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [googleRaw, setGoogleRaw] = useState([]);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const rootRef = useRef(null);
  const focusedRef = useRef(false);
  const sessionRef = useRef(null);
  const awaitingRef = useRef(null);
  const reqRef = useRef(0);
  const listId = useId();

  // Any user action that supersedes an in-flight pick makes its late answer stale.
  const cancel = useCallback(() => { reqRef.current += 1; setBusy(false); }, []);

  useEffect(() => {
    if (!focusedRef.current) setQuery(name || '');
  }, [name]);

  useEffect(() => {
    const q = query.trim();
    if (!open || pending || q.length < 2) { setGoogleRaw([]); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      if (!sessionRef.current) sessionRef.current = newAutocompleteSession();
      const out = await fetchSuggestions(q, sessionRef.current, {
        includedPrimaryTypes: GOOGLE_TYPES,
        ...(lat != null && lng != null ? { locationBias: { center: { lat: Number(lat), lng: Number(lng) }, radius: GOOGLE_BIAS_RADIUS_M } } : {}),
      });
      if (alive) setGoogleRaw(out);
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, open, pending, lat, lng]);
  const google = useMemo(() => googleRaw.filter((g) => g.mainText).slice(0, GOOGLE_LIMIT), [googleRaw]);
  // "Not on Google Maps" is an answer to a search that came up short, so it waits for typed text.
  const typed = query.trim() !== '';
  const offerNotOnMaps = allowNotOnMaps && typed;
  const menuOpen = open && (!!pending || google.length > 0 || typed);

  const items = useMemo(() => {
    if (pending) return [...pending.candidates.map((c) => ({ candidate: c })), { notListed: true }];
    return [...google.map((g) => ({ google: g })), ...(offerNotOnMaps ? [{ notOnMaps: true }] : [])];
  }, [pending, google, offerNotOnMaps]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) { cancel(); setOpen(false); setPending(null); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, cancel]);

  const bind = useCallback((rec, place, source) => {
    setQuery(rec.name);
    setPending(null);
    setError(null);
    setOpen(false);
    onChange({
      ...rec,
      lat: rec.lat ?? place.lat,
      lng: rec.lng ?? place.lng,
      pincode: rec.pincode || place.pincode || '',
      localityRaw: place.localityRaw || '',
      source,
    });
  }, [onChange]);

  const fail = useCallback((kind) => {
    setError(kind);
    setPending(null);
    setOpen(false);
  }, []);

  const mint = useCallback(async (place) => {
    if (!user) {
      awaitingRef.current = place;
      setQuery(place.name);
      setOpen(false);
      setPending(null);
      if (onRequireAuth) onRequireAuth(); else signIn(authReason);
      return;
    }
    const token = ++reqRef.current;
    setBusy(true);
    setError(null);
    try {
      const out = await mintSociety({
        placeId: place.placeId,
        name: place.name,
        lat: place.lat ?? lat ?? undefined,
        lng: place.lng ?? lng ?? undefined,
        localityLabel: localityLabel || place.localityRaw || undefined,
        mintOrigin,
      });
      if (token !== reqRef.current) return;
      if (!out?.society) throw new Error('no society');
      bind(out.society, place, out.created ? 'create' : 'pick');
    } catch (e) {
      if (token === reqRef.current) fail(e?.status === 422 ? 'area' : 'failed');
    } finally {
      if (token === reqRef.current) setBusy(false);
    }
  }, [user, onRequireAuth, signIn, authReason, lat, lng, localityLabel, mintOrigin, bind, fail]);

  useEffect(() => {
    if (user && awaitingRef.current) {
      const place = awaitingRef.current;
      awaitingRef.current = null;
      mint(place);
    }
  }, [user, mint]);

  const pickGoogle = async (suggestion) => {
    if (busy) return;
    const token = ++reqRef.current;
    setBusy(true);
    setError(null);
    let place;
    let res;
    try {
      const d = await fetchPlaceDetails(suggestion);
      if (token !== reqRef.current) return;
      sessionRef.current = null;
      const placeId = d?.placeId || suggestion.placeId;
      if (!d || !placeId) throw new Error('no place');
      place = {
        placeId,
        name: cleanText(d.name || suggestion.mainText).slice(0, 60),
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        pincode: d.pincode || '',
        localityRaw: d.localityRaw || '',
      };
      res = await resolveSociety(place);
      if (token !== reqRef.current) return;
    } catch {
      if (token === reqRef.current) { setBusy(false); fail('failed'); }
      return;
    }
    setBusy(false);
    if (res.society) { bind(res.society, place, 'pick'); return; }
    if (res.candidates.length) { setPending({ place, candidates: res.candidates }); setActive(0); return; }
    mint(place);
  };

  const pickNotOnMaps = () => {
    cancel();
    awaitingRef.current = null;
    setQuery('');
    setPending(null);
    setError(null);
    setOpen(false);
    onChange({ notOnMaps: true, source: 'notOnMaps' });
  };

  const commit = (item) => {
    if (item.google) return pickGoogle(item.google);
    if (item.candidate) return bind(item.candidate, pending.place, 'pick');
    if (item.notListed) return mint(pending.place);
    return pickNotOnMaps();
  };

  const onType = (raw) => {
    cancel();
    setQuery(cleanText(raw));
    setOpen(true);
    setActive(0);
    setPending(null);
    setError(null);
    awaitingRef.current = null;
    if (value || notOnMaps) onChange(null);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active] && !busy) commit(items[active]); }
    else if (e.key === 'Escape') { cancel(); setOpen(false); setPending(null); }
  };

  // Returning to the box while still signed out means the sign-in was dismissed: drop the stalled pick.
  const onFocus = () => {
    focusedRef.current = true;
    if (!user && awaitingRef.current) { awaitingRef.current = null; setQuery(name || ''); }
    setOpen(true);
  };

  const optId = (i) => `${listId}-opt-${i}`;
  const optionClass = (i) => `dz-dropdown__option ${i === active ? 'is-active' : ''}`;
  const candidateMeta = (c) => {
    const parts = [String(c.localitySlug || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())];
    if (pending?.place.lat != null && c.lat != null && c.lng != null) {
      parts.push(t('listProperty.society.distance', { value: distanceLabel(haversineKm(pending.place.lat, pending.place.lng, c.lat, c.lng)) }));
    }
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <div ref={rootRef} className={`dz-dropdown ${open ? 'is-open' : ''}`} style={{ position: 'relative' }}>
      <input
        id={id}
        value={query}
        maxLength={60}
        onChange={(e) => onType(e.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          focusedRef.current = false;
          if (!value && !busy && !awaitingRef.current) setQuery(name || '');
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={menuOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={menuOpen && items[active] ? optId(active) : undefined}
        aria-invalid={invalid || undefined}
        data-err={dataErr}
        data-testid="society-input"
        placeholder={placeholder || t('listProperty.society.placeholder')}
        className={`${inputClassName} ${invalid ? 'dz-invalid' : ''}`}
      />

      {menuOpen && (
        <div className="dz-dropdown__menu" role="listbox" id={listId} aria-label={t('listProperty.society.googleHeading')}>
          {pending ? (
            <>
              <div className="dz-dropdown__group">{t('listProperty.society.candidatesHeading')}</div>
              {pending.candidates.map((c, i) => (
                <button
                  type="button"
                  key={c.slug}
                  id={optId(i)}
                  role="option"
                  aria-selected={false}
                  disabled={busy}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(items[i])}
                  data-testid="society-candidate-option"
                  className={optionClass(i)}
                >
                  <span className="opt-label" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                    {candidateMeta(c) ? <span className="text-xs text-gray-500" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{candidateMeta(c)}</span> : null}
                  </span>
                </button>
              ))}
              <button
                type="button"
                id={optId(pending.candidates.length)}
                role="option"
                aria-selected={false}
                disabled={busy}
                onMouseEnter={() => setActive(pending.candidates.length)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit({ notListed: true })}
                data-testid="society-not-listed-candidate"
                className={optionClass(pending.candidates.length)}
              >
                <MapPin className="opt-icon" />
                <span className="opt-label">{busy ? t('listProperty.society.adding') : t('listProperty.society.notListed', { name: pending.place.name })}</span>
              </button>
            </>
          ) : (
            <>
              {google.length > 0 && <div className="dz-dropdown__group">{t('listProperty.society.googleHeading')}</div>}
              {google.map((g, i) => (
                <button
                  type="button"
                  key={g.placeId}
                  id={optId(i)}
                  role="option"
                  aria-selected={false}
                  disabled={busy}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickGoogle(g)}
                  data-testid="society-google-option"
                  className={optionClass(i)}
                >
                  <MapPin className="opt-icon" />
                  <span className="opt-label" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.mainText}</span>
                    {g.secondaryText ? <span className="text-xs text-gray-500" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.secondaryText}</span> : null}
                  </span>
                </button>
              ))}
              {offerNotOnMaps && (
                <button
                  type="button"
                  id={optId(google.length)}
                  role="option"
                  aria-selected={notOnMaps}
                  onMouseEnter={() => setActive(google.length)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={pickNotOnMaps}
                  data-testid="society-not-on-maps"
                  className={optionClass(google.length)}
                >
                  <MapPinOff className="opt-icon" />
                  <span className="opt-label">{t('listProperty.society.notOnMaps')}</span>
                  {notOnMaps ? <Check className="opt-check" style={{ opacity: 1, transform: 'scale(1)' }} /> : null}
                </button>
              )}
              {google.length === 0 && !allowNotOnMaps && query.trim().length >= 2 && <div className="dz-dropdown__empty">{t('listProperty.society.empty')}</div>}
            </>
          )}
        </div>
      )}

      {busy && !pending ? <p className="mt-1 text-xs text-gray-400" role="status">{t('listProperty.society.adding')}</p> : null}
      {error && (
        <p className="mt-1 text-xs text-red-400" role="alert" data-testid="society-error">
          {t(error === 'area' ? 'listProperty.society.notABuilding' : 'listProperty.society.addFailed')}
        </p>
      )}
      {notOnMaps && !menuOpen ? <p className="mt-1 text-xs text-gray-400">{t('listProperty.society.notOnMapsNote')}</p> : null}
    </div>
  );
}
