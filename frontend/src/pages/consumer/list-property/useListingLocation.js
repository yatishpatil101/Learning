import { useState, useCallback, useRef } from 'react';
import { localities, localityCoords } from './constants.js';
import { reverseGeocode, forwardGeocode } from './geocode.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';

// Fields we auto-fill from a geocode, in the order we surface them.
const AUTOFILL_FIELDS = ['pincode', 'street', 'locality', 'society'];
/* Fields worth a reverse-geocode follow-up when a place pick can't supply them. `society` is excluded:
   a reverse lookup yields address components, never a trustworthy building name. */
const PIN_FALLBACK_FIELDS = ['pincode', 'street', 'locality'];

export default function useListingLocation({ setForm, formRef, errors, setErrors }) {
  /* map search */
  const [mapSearch, setMapSearch] = useState('');
  const [mapSearchStatus, setMapSearchStatus] = useState(''); // '' | 'searching' | 'notfound'
  const [flyTo, setFlyTo] = useState(null);
  // Reverse-geocode auto-fill state: '' | 'filling' | 'done'. Tells the owner we're
  // pulling their address from the pin, and that they should verify the filled fields.
  const [geoFillStatus, setGeoFillStatus] = useState('');
  const lastGeoRef = useRef('');
  const pinSourceRef = useRef(null);
  /* Address fields the owner hand-edited; auto-fill never overwrites them. Tracked explicitly rather than by
     comparing values, so it holds however the field got its value — draft, society binding, prior search. */
  const userEditedRef = useRef({});

  const set = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
    // Record a hand-edited field so a later map search fills the ones around it without clobbering it,
    // and drop the "filled from map" hint once the owner edits what the pin populated.
    if (field === 'pincode' || field === 'street' || field === 'locality' || field === 'society') {
      userEditedRef.current[field] = true;
      setGeoFillStatus((s) => (s ? '' : s));
    }
  }, [errors]);

  const onMapSearchChange = (v) => {
    setMapSearch(v);
    if (mapSearchStatus) setMapSearchStatus('');
  };
  /* Non-destructive: never overwrites a value the owner entered, and a failed lookup leaves the field empty.
     Triggered on discrete events (search hit, pin click/drag) so Google lookups stay sparse. */
  const autofillFromPin = async (lat, lng, replace = false) => {
    const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    if (lastGeoRef.current === key) return; // same spot already looked up
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
  /* A field is ours to write unless hand-edited. `replace` (a deliberate new pick) writes every non-user field,
     filling or CLEARING, so a corrective re-search leaves nothing stale; a pin refine only fills gaps. */
  const applyAddressFill = (geo, replace = false, onlyFields = AUTOFILL_FIELDS) => {
    if (!geo) { setGeoFillStatus(''); return null; }
    // Prefer a canonical Pune locality — fuzzy name or nearest area within ~2.5 km — so a differently
    // spelled area still lands on one; failing that keep Google's raw text rather than leaving it blank.
    const canon = matchLocalityToCanonical(geo.localityRaw, geo.lat, geo.lng);
    const locality = canon ? canon.name : String(geo.localityRaw || '').trim().slice(0, 40);
    // A named place (society/project/building) also gives us the society name to fill;
    // an area or road does not (its "name" is a locality/street, not a society).
    const society = geo.isNamedPlace && geo.name ? String(geo.name).slice(0, 60) : '';
    const incoming = { pincode: geo.pincode || '', street: geo.street || '', locality, society };
    const cur = formRef.current;
    const edited = userEditedRef.current;
    const fills = {};
    for (const f of onlyFields) {
      if (edited[f]) continue;                              // the owner edited it — never touch
      if (replace) {
        // Deliberate new place: adopt the new value, or clear a stale one it can't supply.
        if (incoming[f]) fills[f] = incoming[f];
        else if (cur[f]) fills[f] = '';
      } else if (!cur[f] && incoming[f]) {
        fills[f] = incoming[f];                             // pin refine: only fill empty gaps
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
    }
    // A follow-up lookup that fills nothing must not retract a "filled from the map"
    // hint an earlier pass earned — but it still clears an in-flight 'filling'.
    setGeoFillStatus((s) => (willFill || s === 'done' ? 'done' : ''));
    const after = {};
    for (const f of AUTOFILL_FIELDS) after[f] = f in fills ? fills[f] : cur[f];
    return after;
  };
  /* Area-level places carry no postal_code, so a dropdown pick would leave the pincode blank even though the
     coordinates resolve it. The reverse lookup only writes still-empty fields, so the pick's values win. */
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
    if (lastGeoRef.current !== key) return; // a newer pin superseded this lookup
    applyAddressFill({ ...rev, lat, lng }, false, gaps);
  };
  // Placement rides the form so a restored draft and an edit prefill both carry it.
  const placePin = (lat, lng, source) => {
    pinSourceRef.current = source;
    setForm((prev) => ({ ...prev, propLat: lat, propLng: lng, pinPlaced: true }));
    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
  };
  /* With `geo` the address comes from the result's own components — more precise than, and sparing, a
     reverse-geocode of the pin; `replace` marks it a deliberate pick so stale auto-fills refresh. */
  const flyToCoords = (lat, lng, geo, replace = false, source = 'map') => {
    placePin(lat, lng, source);
    setFlyTo([lat, lng]);
    if (geo) {
      applyPlaceFill(lat, lng, geo, replace);
    } else {
      autofillFromPin(lat, lng, replace);
    }
  };
  /* Picking a locality recenters the pin so the listing is never silently left on the Baner default. A live
     Google pick gives exact coords; otherwise fall back to the static table for the known shortlist. */
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
  };
  const runMapSearch = async () => {
    const q = mapSearch.trim();
    if (!q) return;
    // Match a known Pune locality first — instant, works offline.
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
      // Google resolves both localities and named societies/projects (e.g. "Aspiria")
      // and hands back the address components — fill the address from those directly.
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
  /* Fill from the place's own components rather than a reverse lookup of the pin. Marked already-resolved so
     the pin-move that follows does not kick off a redundant reverse-geocode. */
  const onAreaSelect = (details) => {
    if (!details || details.lat == null || details.lng == null) return;
    setMapSearchStatus('');
    placePin(details.lat, details.lng, 'map');
    setFlyTo([details.lat, details.lng]);
    applyPlaceFill(details.lat, details.lng, details, true);
  };

  const onSocietyPick = ({ id, name, lat, lng }) => {
    set('societyId', id);
    set('society', name);
    if (lat == null || lng == null || pinSourceRef.current === 'manual') return;
    placePin(lat, lng, 'society');
    setFlyTo([lat, lng]);
  };

  return {
    set,
    mapSearch, mapSearchStatus, flyTo, geoFillStatus,
    onMapSearchChange, runMapSearch, onAreaSelect, onSocietyPick, onLocalityChange, onPinMove,
  };
}
