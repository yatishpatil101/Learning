import { useState, useCallback, useRef } from 'react';
import { localities, localityCoords } from './constants.js';
import { reverseGeocode, forwardGeocode } from './geocode.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';

export default function useListingLocation({ setForm, formRef, errors, setErrors }) {
  /* map search */
  const [mapSearch, setMapSearch] = useState('');
  const [mapSearchStatus, setMapSearchStatus] = useState(''); // '' | 'searching' | 'notfound'
  const [flyTo, setFlyTo] = useState(null);
  // Reverse-geocode auto-fill state: '' | 'filling' | 'done'. Tells the owner we're
  // pulling their address from the pin, and that they should verify the filled fields.
  const [geoFillStatus, setGeoFillStatus] = useState('');
  const lastGeoRef = useRef('');
  // Address fields the owner has MANUALLY edited (typed in, or picked from the
  // Locality / Society dropdowns). These are sacred: auto-fill never overwrites them.
  // Tracked explicitly (not by comparing values) so it stays correct no matter how a
  // field got its current value — a restored draft, a society binding, a prior search.
  // `set()` — the only path user edits flow through — marks the field here; auto-fill
  // writes via setForm directly, so it never marks anything.
  const userEditedRef = useRef({});
  // Whether the owner has actually placed the property on the map (via a locality
  // pick, a search hit, or by dragging the pin). Until then the coordinates are
  // just the form's Baner default, so we don't treat the listing as geo-located.
  const [locationSet, setLocationSet] = useState(false);

  const set = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
    // Every address field the owner touches by hand becomes sacred: record it so a later
    // map search fills/clears the fields around it but never clobbers their entry. Also
    // drop the "filled from map" hint once they edit a field the pin populated.
    if (field === 'pincode' || field === 'street' || field === 'locality' || field === 'society') {
      userEditedRef.current[field] = true;
      setGeoFillStatus((s) => (s ? '' : s));
    }
  }, [errors]);

  /* ---------- map search ---------- */
  const onMapSearchChange = (v) => {
    setMapSearch(v);
    if (mapSearchStatus) setMapSearchStatus('');
  };
  // Reverse-geocode the pinned spot and gently fill any address fields the owner hasn't
  // typed yet — pincode, street and (when it maps to a known option) locality. Non-destructive:
  // we never overwrite a value the owner already entered, and a failed lookup just leaves the
  // fields empty for manual entry. Triggered on discrete events (search hit, pin click/drag)
  // so Google geocoding lookups stay sparse.
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
  // Fields we auto-fill from a geocode, in the order we surface them.
  const AUTOFILL_FIELDS = ['pincode', 'street', 'locality', 'society'];
  // Fill the address from a geocode result (reverse-pin OR a place pick). Ownership is
  // explicit: a field is ours to write UNLESS the owner has hand-edited it (tracked in
  // userEditedRef via set()). `replace` (a deliberate new place pick / search) writes
  // every non-user field — filling the new value or CLEARING one the new place can't
  // supply — so a corrective re-search never leaves a stale value behind. A pin refine
  // (replace=false) only fills gaps, so nudging the pin won't wipe a searched address.
  const applyAddressFill = (geo, replace = false) => {
    if (!geo) { setGeoFillStatus(''); return; }
    // Resolve the locality: prefer a canonical Pune locality — matched by fuzzy name
    // OR the nearest area within ~2.5 km of the pin, so an off-list or differently
    // spelled area (e.g. an unlisted "Rajiv Gandhi Infotech Park") still lands on the
    // nearest canonical locality. Failing that, keep Google's raw locality as free text(the picker accepts any value) so
    // we never leave it blank for a place we could actually name.
    const canon = matchLocalityToCanonical(geo.localityRaw, geo.lat, geo.lng);
    const locality = canon ? canon.name : String(geo.localityRaw || '').trim().slice(0, 40);
    // A named place (society/project/building) also gives us the society name to fill;
    // an area or road does not (its "name" is a locality/street, not a society).
    const society = geo.isNamedPlace && geo.name ? String(geo.name).slice(0, 60) : '';
    const incoming = { pincode: geo.pincode || '', street: geo.street || '', locality, society };
    const cur = formRef.current;
    const edited = userEditedRef.current;
    const fills = {};
    for (const f of AUTOFILL_FIELDS) {
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
    setGeoFillStatus(willFill ? 'done' : '');
  };
  // Recenter the pin on a spot. When `geo` (a resolved forward/search result) is
  // passed we fill the address from its own components — more precise than, and
  // sparing, a reverse-geocode of the pin; `replace` marks it a deliberate new-place
  // pick so stale auto-fills are refreshed. Otherwise we reverse-geocode the spot.
  const flyToCoords = (lat, lng, geo, replace = false) => {
    setForm((prev) => ({ ...prev, propLat: lat, propLng: lng }));
    setFlyTo([lat, lng]);
    setLocationSet(true);
    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
    if (geo) {
      lastGeoRef.current = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
      applyAddressFill({ lat, lng, ...geo }, replace);
    } else {
      autofillFromPin(lat, lng, replace);
    }
  };
  // Picking a locality recenters the pin on that area so the listing is never left
  // silently pinned to the Baner default. The owner can still drag the pin to the
  // exact spot afterwards; changing locality re-centres it to the new area. When the
  // locality comes from a live Google Places pick we get exact coords — use them;
  // otherwise fall back to the static coords table for the known shortlist.
  const onLocalityChange = (v, coords) => {
    set('locality', v);
    if (coords && coords.lat != null && coords.lng != null) {
      flyToCoords(coords.lat, coords.lng);
    } else if (v && localityCoords[v]) {
      flyToCoords(localityCoords[v][0], localityCoords[v][1]);
    }
  };
  const onPinMove = (lat, lng) => {
    setForm((prev) => ({ ...prev, propLat: lat, propLng: lng }));
    setLocationSet(true);
    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
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
  const doMapSearch = (e) => {
    if (e && e.key !== 'Enter') return;
    if (e) e.preventDefault();
    runMapSearch();
  };
  // An autocomplete suggestion was picked: move the pin to its exact location and
  // fill the address from the place's own components (more precise than a reverse
  // lookup of the pin). Mark this spot as already-resolved so the pin-move that
  // follows doesn't kick off a redundant reverse-geocode.
  const onAreaSelect = (details) => {
    if (!details || details.lat == null || details.lng == null) return;
    setMapSearchStatus('');
    lastGeoRef.current = `${Number(details.lat).toFixed(5)},${Number(details.lng).toFixed(5)}`;
    setForm((prev) => ({ ...prev, propLat: details.lat, propLng: details.lng }));
    setFlyTo([details.lat, details.lng]);
    setLocationSet(true);
    if (errors.location) setErrors((prev) => { const n = { ...prev }; delete n.location; return n; });
    applyAddressFill(details, true);
  };

  return {
    set,
    mapSearch, mapSearchStatus, flyTo, geoFillStatus, locationSet, setLocationSet,
    onMapSearchChange, doMapSearch, runMapSearch, onAreaSelect, onLocalityChange, onPinMove,
  };
}
