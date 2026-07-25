import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import LocationPicker from '../../pages/consumer/list-property/LocationPicker.jsx';
import { fetchSuggestions, fetchPlaceDetails, newAutocompleteSession } from '../../lib/places.js';

/* Resident location-correction picker. A verified resident searches (Places
   autocomplete) or drags the pin to the society's exact spot; the chosen
   coordinates are the submitted value. Editable lat/lng fields keep it precise
   and usable even where the interactive map isn't configured. We capture only
   { lat, lng, placeId, label } — never any other Google Place field. */

const INP = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-teal-400/50';

export default function SocietyLocationModal({ societyName, initial, onSubmit, onClose }) {
  const [q, setQ] = useState('');
  const [sugs, setSugs] = useState([]);
  const [latStr, setLatStr] = useState(initial && initial.lat != null ? String(initial.lat) : '');
  const [lngStr, setLngStr] = useState(initial && initial.lng != null ? String(initial.lng) : '');
  const [placeId, setPlaceId] = useState('');
  const [label, setLabel] = useState('');
  const [flyTo, setFlyTo] = useState(null);
  const sessionRef = useRef(newAutocompleteSession());
  const tRef = useRef();
  const pickSeq = useRef(0); // invalidates a slow place-detail fetch when the user picks/edits again

  // Raw strings keep decimal typing intact ("18." mid-entry); parse only to validate/submit.
  const lat = latStr.trim() === '' ? null : Number(latStr);
  const lng = lngStr.trim() === '' ? null : Number(lngStr);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => () => clearTimeout(tRef.current), []);

  const onSearch = (val) => {
    setQ(val);
    clearTimeout(tRef.current);
    if (val.trim().length < 2) { setSugs([]); return; }
    tRef.current = setTimeout(async () => {
      const out = await fetchSuggestions(val, sessionRef.current);
      setSugs(out.slice(0, 6));
    }, 250);
  };

  const choose = async (s) => {
    setQ(s.mainText || '');
    setSugs([]);
    const seq = ++pickSeq.current;
    const d = await fetchPlaceDetails(s);
    if (seq !== pickSeq.current) return; // a newer pick/edit superseded this one
    if (d && d.lat != null && d.lng != null) {
      setLatStr(String(d.lat)); setLngStr(String(d.lng)); setFlyTo([d.lat, d.lng]);
      setPlaceId(s.placeId || '');
      setLabel(d.name || s.mainText || '');
      sessionRef.current = newAutocompleteSession();
    }
  };

  // A pin drag/click or a manual field edit is a hand correction — invalidate any
  // in-flight place lookup and drop the Places id so we don't mislabel the coords.
  const onPinMove = (la, ln) => { pickSeq.current++; setPlaceId(''); setLatStr(String(la)); setLngStr(String(ln)); };
  const editLat = (v) => { pickSeq.current++; setPlaceId(''); setLatStr(v); };
  const editLng = (v) => { pickSeq.current++; setPlaceId(''); setLngStr(v); };

  const canSave = Number.isFinite(lat) && Number.isFinite(lng);
  const mapLat = Number.isFinite(lat) ? lat : (initial && initial.lat != null ? initial.lat : 18.553);
  const mapLng = Number.isFinite(lng) ? lng : (initial && initial.lng != null ? initial.lng : 73.86);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Suggest society location" className="glass rounded-2xl p-6 w-full max-w-lg" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name="map-pin" className="w-5 h-5 text-teal-400" /> Suggest correct location</h3>
        <p className="text-gray-400 text-sm mb-4">Search for {societyName || 'the society'} or drag the pin to its exact spot. Our team reviews it before the map updates.</p>

        <div className="relative mb-3">
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search the society or a nearby landmark" className={INP} aria-label="Search location" />
          {sugs.length ? (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-[#1b1733] shadow-xl overflow-hidden">
              {sugs.map((s) => (
                <li key={s.placeId}>
                  <button type="button" onClick={() => choose(s)} className="w-full text-left px-3 py-2 hover:bg-white/5">
                    <div className="text-sm text-white">{s.mainText}</div>
                    {s.secondaryText ? <div className="text-[11px] text-gray-500">{s.secondaryText}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-2xl overflow-hidden mb-3" style={{ height: 220 }}>
          <LocationPicker lat={mapLat} lng={mapLng} flyTo={flyTo} onMove={onPinMove} />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-1">
          <label className="text-[11px] text-gray-400">Latitude
            <input value={latStr} onChange={(e) => editLat(e.target.value)} inputMode="decimal" placeholder="18.5590" className={INP + ' mt-1'} aria-label="Latitude" />
          </label>
          <label className="text-[11px] text-gray-400">Longitude
            <input value={lngStr} onChange={(e) => editLng(e.target.value)} inputMode="decimal" placeholder="73.7868" className={INP + ' mt-1'} aria-label="Longitude" />
          </label>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">We store only the coordinates — never Google ratings, photos or reviews.</p>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-outline flex-1">Cancel</button>
          <button onClick={() => onSubmit({ lat, lng, placeId, label })} disabled={!canSave} className="btn-teal flex-1 disabled:opacity-50 disabled:cursor-not-allowed">Submit for review</button>
        </div>
      </div>
    </div>
  );
}
