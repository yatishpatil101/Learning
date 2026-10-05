import { useState, useCallback, useRef } from 'react';
import { localities, localityCoords, isLandType } from './constants.js';
import { reverseGeocode, forwardGeocode } from './geocode.js';
import { matchLocalityToCanonical, localityBySlug } from '../../../data/localities.js';
import { getSociety } from '../../../services/societyService.js';

const AUTOFILL_FIELDS = ['pincode', 'street', 'locality', 'society'];
/* `society` is excluded: a reverse lookup yields address components, never a trustworthy
 * building name. */
const PIN_FALLBACK_FIELDS = ['pincode', 'street', 'locality'];
const SOCIETY_PIN_FIELDS = ['locality', 'pincode'];
const SOCIETY_FILL_LABELS = {
  society: 'society',
  locality: 'locality',
  pincode: 'pincode',
  pin: 'pin',
  age: 'age',
  reraId: 'reraId',
};
const SOCIETY_FILL_TRACKED_FIELDS = new Set(Object.keys(SOCIETY_FILL_LABELS).filter((field) => field !== 'pin'));

const ageBucketFromYear = (year) => {
  const y = Number(year);
  if (!Number.isFinite(y)) return '';
  const age = new Date().getFullYear() - y;
  if (age < 1) return 'new';
  if (age <= 5) return '1-5';
  if (age <= 10) return '5-10';
  if (age <= 15) return '10-15';
  return '15+';
};

const isPreCompletion = (form) => !isLandType(form.propertyType)
  && (form.construction === 'new' || form.construction === 'under');

const societyLocality = (society) =>
  society.locality || society.localityLabel || localityBySlug(society.localitySlug)?.name || '';

const societyPincode = (society) =>
  society.pincode || society.pinCode || society.postalCode || '';

export default function useListingLocation({ setForm, formRef, errors, setErrors }) {
  const [mapSearch, setMapSearch] = useState('');
  const [mapSearchStatus, setMapSearchStatus] = useState('');
  const [flyTo, setFlyTo] = useState(null);
  // Reverse-geocode auto-fill state: '' | 'filling' | 'done'. Tells the owner we're
  // pulling their address from the pin, and that they should verify the filled fields.
  const [geoFillStatus, setGeoFillStatus] = useState('');
  const [societyFillNotice, setSocietyFillNotice] = useState(null);
  const [currentLocationStatus, setCurrentLocationStatus] = useState('');
  const lastGeoRef = useRef('');
  const pinSourceRef = useRef(null);
  const societyFillRef = useRef({});
  const societyPickSeqRef = useRef(0);
  const currentLocationSeqRef = useRef(0);
  /* Address fields the owner hand-edited; auto-fill never overwrites them. */
  const userEditedRef = useRef({});

  const set = useCallback((field, value, options) => {
    setForm((prev) => ({ ...prev, [field]: value }), options);
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
    if (field === 'street' || SOCIETY_FILL_TRACKED_FIELDS.has(field)) {
      userEditedRef.current[field] = true;
      delete societyFillRef.current[field];
      setGeoFillStatus((s) => (s ? '' : s));
      setSocietyFillNotice(null);
    }
  }, [errors, setErrors, setForm]);

  const clearErrors = useCallback((fields) => {
    setErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      fields.forEach((field) => {
        if (next[field]) {
          delete next[field];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [setErrors]);

  const onMapSearchChange = (v) => {
    setMapSearch(v);
    if (mapSearchStatus) setMapSearchStatus('');
  };
  /* Non-destructive: never overwrites a value the owner entered, and a failed lookup leaves the
   * field empty. */
  const autofillFromPin = async (lat, lng, replace = false) => {
    const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    if (lastGeoRef.current === key) return;
    lastGeoRef.current = key;
    setGeoFillStatus('filling');
    const geo = await reverseGeocode(lat, lng);
    // A newer pin superseded this lookup while it was in flight — discard the stale
    // response so it can't fill fields (or flip the status) for the wrong location.
    if (lastGeoRef.current !== key) return;
    // Carry the pin's coords so the locality resolver can fall back to the nearest
    // known area when the reverse-geocode name doesn't match our list.
    applyAddressFill({ ...geo, lat, lng }, replace);
  };
  /* `replace` (a deliberate new pick) writes every non-user field, filling or CLEARING, so a
   * corrective re-search leaves nothing stale; a pin refine only fills gaps. */
  const applyAddressFill = (geo, replace = false, onlyFields = AUTOFILL_FIELDS) => {
    if (!geo) { setGeoFillStatus(''); return null; }
    // Prefer a canonical Pune locality — fuzzy name or nearest area within ~2.5 km.
    // Otherwise keep Google's raw text rather than leaving it blank.
    const canon = matchLocalityToCanonical(geo.localityRaw, geo.lat, geo.lng);
    const locality = canon ? canon.name : String(geo.localityRaw || '').trim().slice(0, 40);
    const society = geo.isNamedPlace && geo.name ? String(geo.name).slice(0, 60) : '';
    const incoming = { pincode: geo.pincode || '', street: geo.street || '', locality, society };
    const cur = formRef.current;
    const edited = userEditedRef.current;
    const fills = {};
    for (const f of onlyFields) {
      if (edited[f]) continue;
      // the owner edited it — never touch
      if (replace) {
        // Deliberate new place: adopt the new value, or clear a stale one it can't supply.
        if (incoming[f]) fills[f] = incoming[f];
        else if (cur[f]) fills[f] = '';
      } else if (!cur[f] && incoming[f]) {
        fills[f] = incoming[f];
      }
    }
    const willFill = Object.keys(fills).length > 0;
    if (willFill) {
      setForm((prev) => {
        const next = { ...prev, ...fills };
        // Society name changed/cleared → drop any bound society id so SocietySelect
        // re-matches (or offers to add) it, never claiming a link the owner didn't pick.
        if ('society' in fills) next.societyId = '';
        return next;
      });
      for (const f of Object.keys(fills)) delete societyFillRef.current[f];
    }
    // A follow-up lookup that fills nothing must not retract a "filled from the map"
    // hint an earlier pass earned — but it still clears an in-flight 'filling'.
    setGeoFillStatus((s) => (willFill || s === 'done' ? 'done' : ''));
    const after = {};
    for (const f of AUTOFILL_FIELDS) after[f] = f in fills ? fills[f] : cur[f];
    return after;
  };
  const applyPlaceFill = async (lat, lng, geo, replace = false) => {
    const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    lastGeoRef.current = key;
    const after = applyAddressFill({ lat, lng, ...geo }, replace);
    if (!after) return;
    const edited = userEditedRef.current;
    const gaps = PIN_FALLBACK_FIELDS.filter((f) => !edited[f] && !after[f]);
    if (!gaps.length) return;
    setGeoFillStatus('filling');
    const rev = await reverseGeocode(lat, lng);
    if (lastGeoRef.current !== key) return;
    applyAddressFill({ ...rev, lat, lng }, false, gaps);
  };
  // Placement rides the form so a restored draft and an edit prefill both carry it.
  const placePin = (lat, lng, source) => {
    if (source === 'manual' || source === 'society') currentLocationSeqRef.current += 1;
    pinSourceRef.current = source;
    setForm((prev) => ({ ...prev, propLat: lat, propLng: lng, pinPlaced: true }));
    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
  };
  const flyToCoords = (lat, lng, geo, replace = false, source = 'map') => {
    placePin(lat, lng, source);
    setFlyTo([lat, lng]);
    if (geo) {
      applyPlaceFill(lat, lng, geo, replace);
    } else {
      autofillFromPin(lat, lng, replace);
    }
  };
  /* Picking a locality recenters the pin so the listing is never silently left on the Baner
   * default. */
  const onLocalityChange = (v, coords) => {
    set('locality', v);
    if (pinSourceRef.current === 'manual' || pinSourceRef.current === 'society') return;
    if (coords && coords.lat != null && coords.lng != null) {
      flyToCoords(coords.lat, coords.lng, undefined, false, 'locality');
    } else if (v && localityCoords[v]) {
      flyToCoords(localityCoords[v][0], localityCoords[v][1], undefined, false, 'locality');
    }
  };
  const onPinMove = (lat, lng) => {
    placePin(lat, lng, 'manual');
    autofillFromPin(lat, lng);
    setCurrentLocationStatus('');
  };
  const runMapSearch = async () => {
    const q = mapSearch.trim();
    if (!q) return;
    const ql = q.toLowerCase();
    const hit = localities.find((name) => {
      const n = name.toLowerCase();
      return n === ql || n.includes(ql) || ql.includes(n);
    });
    if (hit && localityCoords[hit]) {
      flyToCoords(localityCoords[hit][0], localityCoords[hit][1], undefined, true);
      setMapSearchStatus('');
      return;
    }
    setMapSearchStatus('searching');
    try {
      const hitLoc = await forwardGeocode(q);
      if (hitLoc) {
        flyToCoords(hitLoc.lat, hitLoc.lng, hitLoc, true);
        setMapSearchStatus('');
      } else {
        setMapSearchStatus('notfound');
      }
    } catch {
      setMapSearchStatus('notfound');
    }
  };
  const onAreaSelect = (details) => {
    if (!details || details.lat == null || details.lng == null) return;
    setMapSearchStatus('');
    placePin(details.lat, details.lng, 'map');
    setFlyTo([details.lat, details.lng]);
    applyPlaceFill(details.lat, details.lng, details, true);
  };

  const fillFromSocietyPin = async (society, lat, lng, gaps, seq) => {
    const geo = society.localityRaw && !gaps.includes('pincode') ? {} : await reverseGeocode(lat, lng);
    if (societyPickSeqRef.current !== seq || pinSourceRef.current !== 'society') return;
    const raw = society.localityRaw || geo.localityRaw || '';
    const canon = matchLocalityToCanonical(raw, lat, lng);
    const incoming = { locality: canon ? canon.name : String(raw).trim().slice(0, 40), pincode: geo.pincode || '' };
    const filled = gaps.filter((f) => incoming[f] && !userEditedRef.current[f]);
    if (!filled.length) return;
    setForm((prev) => ({ ...prev, ...Object.fromEntries(filled.map((f) => [f, incoming[f]])) }));
    filled.forEach((f) => { societyFillRef.current[f] = true; });
    clearErrors(filled);
    setSocietyFillNotice((n) => n && { ...n, fields: [...new Set([...n.fields, ...filled.map((f) => SOCIETY_FILL_LABELS[f])])] });
  };

  const applySocietyPick = (society, seq) => {
    const cur = formRef.current;
    const fills = {};
    const filled = [];
    const fill = (field, value) => {
      if (!value || userEditedRef.current[field]) return;
      if (!cur[field] || societyFillRef.current[field]) {
        fills[field] = String(value).slice(0, field === 'society' ? 60 : 40);
        filled.push(SOCIETY_FILL_LABELS[field]);
      }
    };
    const explicitFields = {};
    if (society.name) {
      explicitFields.society = String(society.name).slice(0, 60);
      filled.push(SOCIETY_FILL_LABELS.society);
    }
    fill('locality', societyLocality(society));
    fill('pincode', societyPincode(society));
    if (society.year) {
      const age = ageBucketFromYear(society.year);
      if (age) fill('age', age);
    }
    const rera = society.rera || society.reraId || '';
    if (rera && isPreCompletion(cur)) fill('reraId', String(rera).toUpperCase());
    const lat = society.lat == null ? null : Number(society.lat);
    const lng = society.lng == null ? null : Number(society.lng);
    const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && pinSourceRef.current !== 'manual';
    if (hasPin) filled.push(SOCIETY_FILL_LABELS.pin);
    const pinGaps = hasPin
      ? SOCIETY_PIN_FIELDS.filter((f) => !(f in fills) && !userEditedRef.current[f] && (!cur[f] || societyFillRef.current[f]))
      : [];
    set('societyId', society.id || '', { explicit: true });
    if ('society' in explicitFields) {
      set('society', explicitFields.society, { explicit: true });
      delete userEditedRef.current.society;
    }
    if (Object.keys(fills).length) setForm((prev) => ({ ...prev, ...fills }));
    Object.keys(fills).forEach((field) => { societyFillRef.current[field] = true; });
    if (hasPin) {
      placePin(lat, lng, 'society');
      setFlyTo([lat, lng]);
    }
    clearErrors(['societyId', ...Object.keys(fills), ...(hasPin ? ['location'] : [])]);
    setSocietyFillNotice(society.name ? { name: society.name, fields: [...new Set(filled)] } : null);
    if (pinGaps.length) fillFromSocietyPin(society, lat, lng, pinGaps, seq);
  };

  const onSocietyPick = async (picked) => {
    const seq = societyPickSeqRef.current + 1;
    societyPickSeqRef.current = seq;
    if (!picked || picked.source === 'type' || picked.source === 'match') {
      set('societyId', picked?.id || '', { explicit: true });
      set('society', picked?.name || '', { explicit: true });
      return;
    }
    let society = picked;
    if (picked.slug && (picked.year == null || !picked.rera)) {
      try {
        const full = await getSociety(picked.slug);
        const known = Object.fromEntries(Object.entries(full || {}).filter(([, v]) => v != null && v !== ''));
        if (full && societyPickSeqRef.current === seq) society = { ...picked, ...known };
      } catch {}
    }
    if (societyPickSeqRef.current === seq) applySocietyPick(society, seq);
  };

  const canUseCurrentLocation = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.geolocation
    && (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const useCurrentLocation = () => {
    if (!canUseCurrentLocation) {
      setCurrentLocationStatus('unavailable');
      return;
    }
    setCurrentLocationStatus('locating');
    const seq = currentLocationSeqRef.current + 1;
    currentLocationSeqRef.current = seq;
    const pinSourceAtRequest = pinSourceRef.current;
    const isCurrentRequestStale = () => currentLocationSeqRef.current !== seq
      || (pinSourceRef.current !== pinSourceAtRequest && (pinSourceRef.current === 'manual' || pinSourceRef.current === 'society'));
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (isCurrentRequestStale()) return;
      const lat = coords.latitude;
      const lng = coords.longitude;
      const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
      lastGeoRef.current = key;
      placePin(lat, lng, 'current');
      setFlyTo([lat, lng]);
      setGeoFillStatus('filling');
      const geo = await reverseGeocode(lat, lng);
      if (lastGeoRef.current !== key || isCurrentRequestStale()) return;
      applyAddressFill({ ...geo, lat, lng }, false, ['locality', 'pincode']);
      setCurrentLocationStatus('done');
    }, (err) => {
      if (isCurrentRequestStale()) return;
      if (err?.code === 1) setCurrentLocationStatus('denied');
      else if (err?.code === 3) setCurrentLocationStatus('timeout');
      else setCurrentLocationStatus('error');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };

  return {
    set,
    mapSearch, mapSearchStatus, flyTo, geoFillStatus, societyFillNotice,
    currentLocationStatus, canUseCurrentLocation, useCurrentLocation,
    onMapSearchChange, runMapSearch, onAreaSelect, onSocietyPick, onLocalityChange, onPinMove,
  };
}
