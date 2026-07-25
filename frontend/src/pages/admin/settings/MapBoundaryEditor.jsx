import { useEffect, useRef, useState } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search, X, Loader2 } from 'lucide-react';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID, GOOGLE_MAPS_HAS_DDS } from '../../../lib/mapsConfig.js';
import { fetchAdminSuggestions, fetchPlaceViewport, newAutocompleteSession } from '../../../lib/places.js';

/* Visual boundary editor for the admin Maps panel. Instead of typing four latitudes,
   an operator drags/resizes a rectangle on a real map, or searches a city/locality and
   drops its Google "viewport" straight into the box. It edits the SAME center/bounds the
   numeric inputs do (controlled), so the two stay in sync. Fail-soft: with no Maps key it
   renders a hint and the numeric inputs remain the way to edit. */

const r5 = (n) => Math.round(n * 1e5) / 1e5;
const validBounds = (b) => b && [b.north, b.south, b.east, b.west].every((n) => Number.isFinite(n));
const validCenter = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng);

// An editable + draggable google.maps.Rectangle bound to `bounds`. Emits rounded
// bounds on user edits; ignores the echo when we programmatically reset it from props.
function EditableRectangle({ bounds, onBoundsChange }) {
  const map = useMap();
  const maps = useMapsLibrary('maps');
  const rectRef = useRef(null);
  const skip = useRef(false);
  const cbRef = useRef(onBoundsChange);
  cbRef.current = onBoundsChange;

  useEffect(() => {
    if (!map || !maps) return undefined;
    const rect = new maps.Rectangle({
      map,
      editable: true,
      draggable: true,
      strokeColor: '#14b8a6',
      strokeWeight: 2,
      fillColor: '#14b8a6',
      fillOpacity: 0.08,
    });
    rectRef.current = rect;
    const emit = () => {
      if (skip.current) return;
      const b = rect.getBounds();
      if (!b) return;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      cbRef.current({ north: r5(ne.lat()), south: r5(sw.lat()), east: r5(ne.lng()), west: r5(sw.lng()) });
    };
    const listener = rect.addListener('bounds_changed', emit);
    return () => {
      listener.remove();
      rect.setMap(null);
      rectRef.current = null;
    };
    // onBoundsChange is intentionally omitted — cbRef keeps the listener stable so
    // the rectangle isn't torn down and rebuilt on every parent re-render.
  }, [map, maps]);

  // Push external (numeric-input / search) changes onto the rectangle without looping.
  useEffect(() => {
    const rect = rectRef.current;
    if (!rect || !validBounds(bounds)) return;
    const cur = rect.getBounds();
    if (cur) {
      const ne = cur.getNorthEast();
      const sw = cur.getSouthWest();
      if (
        r5(ne.lat()) === r5(bounds.north) && r5(sw.lat()) === r5(bounds.south) &&
        r5(ne.lng()) === r5(bounds.east) && r5(sw.lng()) === r5(bounds.west)
      ) return;
    }
    skip.current = true;
    rect.setBounds({ north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west });
    skip.current = false;
  }, [bounds]);

  return null;
}

// Google "data-driven styling" boundary highlight — renders the REAL administrative /
// locality polygon for the searched place (matched by placeId) in teal, the way native
// Google Maps outlines an area. Purely a visual aid: the saved constraint stays the
// rectangle the fields hold (Places restriction is rectangle/circle-only). Fail-soft —
// only attempted with a data-driven Map ID, and every Google call is wrapped so a map
// without these feature layers (e.g. DEMO_MAP_ID) simply shows no outline.
const BOUNDARY_LAYER_TYPES = [
  'LOCALITY',
  'ADMINISTRATIVE_AREA_LEVEL_3',
  'ADMINISTRATIVE_AREA_LEVEL_2',
  'ADMINISTRATIVE_AREA_LEVEL_1',
];
const HIGHLIGHT_STYLE = {
  strokeColor: '#14b8a6',
  strokeWeight: 2,
  strokeOpacity: 1,
  fillColor: '#14b8a6',
  fillOpacity: 0.12,
};

function BoundaryHighlight({ placeId }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !GOOGLE_MAPS_HAS_DDS || typeof map.getFeatureLayer !== 'function') return undefined;
    // Only the layer that actually contains this placeId paints; the rest never match.
    const styleFn = (opts) =>
      placeId && opts.feature?.placeId === placeId ? HIGHLIGHT_STYLE : null;
    const layers = [];
    for (const type of BOUNDARY_LAYER_TYPES) {
      try {
        const layer = map.getFeatureLayer(type);
        layer.style = placeId ? styleFn : null;
        layers.push(layer);
      } catch {
        // This feature layer isn't enabled on the configured Map ID — skip it.
      }
    }
    return () => {
      for (const layer of layers) {
        try { layer.style = null; } catch {}
      }
    };
  }, [map, placeId]);

  return null;
}

// Overlay search: type a place → pick → drop its viewport into the boundary.
function CitySearch({ onPick }) {
  const map = useMap();
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setList([]); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      if (!tokenRef.current) tokenRef.current = newAutocompleteSession();
      const res = await fetchAdminSuggestions(term, tokenRef.current);
      if (alive) { setList(res || []); setOpen(true); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const pick = async (s) => {
    setBusy(true);
    setOpen(false);
    const display = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
    setQ(display);
    const vp = await fetchPlaceViewport(s);
    tokenRef.current = null; // details fetch closes the billing session
    setBusy(false);
    if (!vp) return;
    onPick(vp, s.placeId);
    if (map && validBounds(vp.bounds)) {
      map.fitBounds(vp.bounds);
    } else if (map && validCenter(vp.center)) {
      map.panTo(vp.center);
      map.setZoom(12);
    }
  };

  const clear = () => { setQ(''); setList([]); setOpen(false); };

  return (
    <div className="absolute left-3 top-3 z-10 w-[min(20rem,calc(100%-1.5rem))]">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-2/95 px-3 py-2 shadow-xl backdrop-blur">
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-teal" /> : <Search className="h-4 w-4 shrink-0 text-gray-400" />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => list.length && setOpen(true)}
          placeholder="Search a city or locality to set its area"
          className="w-full bg-transparent text-sm text-white placeholder:text-gray-500 outline-none"
          aria-label="Search a place to set the city boundary"
        />
        {q ? <button type="button" onClick={clear} aria-label="Clear search" className="shrink-0 text-gray-400 hover:text-white"><X className="h-4 w-4" /></button> : null}
      </div>
      {open && list.length ? (
        <ul className="mt-1.5 max-h-60 overflow-auto rounded-xl border border-white/10 bg-ink-2/98 py-1 shadow-2xl backdrop-blur">
          {list.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-white/5"
              >
                <span className="text-sm text-gray-100">{s.mainText}</span>
                {s.secondaryText ? <span className="text-xs text-gray-500">{s.secondaryText}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Fits the map to the boundary on first load so the rectangle is framed on open.
function InitialFit({ bounds, center }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!map || done.current) return;
    if (validBounds(bounds)) { map.fitBounds(bounds); done.current = true; }
    else if (validCenter(center)) { map.panTo(center); map.setZoom(12); done.current = true; }
  }, [map, bounds, center]);
  return null;
}

export default function MapBoundaryEditor({ center, bounds, onChange }) {
  const [activePlaceId, setActivePlaceId] = useState(null);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
        <p className="max-w-sm text-xs text-gray-500">
          Add <code className="text-gray-400">VITE_GOOGLE_MAPS_API_KEY</code> to enable the visual map editor.
          You can still set the boundary using the fields below.
        </p>
      </div>
    );
  }

  const fallbackCenter = validCenter(center)
    ? center
    : (validBounds(bounds) ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 } : { lat: 18.553, lng: 73.86 });

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div className="relative overflow-hidden rounded-xl border border-white/10" style={{ height: 360 }}>
        <Map
          mapId={GOOGLE_MAPS_MAP_ID}
          colorScheme="DARK"
          defaultCenter={fallbackCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          clickableIcons={false}
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
        >
          <InitialFit bounds={bounds} center={center} />
          {GOOGLE_MAPS_HAS_DDS ? <BoundaryHighlight placeId={activePlaceId} /> : null}
          <EditableRectangle bounds={bounds} onBoundsChange={(b) => onChange({ bounds: b, center: { lat: r5((b.north + b.south) / 2), lng: r5((b.east + b.west) / 2) } })} />
          <CitySearch
            onPick={(vp, placeId) => {
              setActivePlaceId(placeId);
              onChange({
                center: vp.center ? { lat: r5(vp.center.lat), lng: r5(vp.center.lng) } : undefined,
                bounds: vp.bounds ? { north: r5(vp.bounds.north), south: r5(vp.bounds.south), east: r5(vp.bounds.east), west: r5(vp.bounds.west) } : undefined,
              });
            }}
          />
        </Map>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Drag the teal box or its edges to adjust the area, or search a place above to snap the box to that region. The fields below stay in sync.
      </p>
      {!GOOGLE_MAPS_HAS_DDS ? (
        <p className="mt-1 text-xs text-gray-600">
          Tip: set a data-driven <code className="text-gray-500">VITE_GOOGLE_MAPS_MAP_ID</code> to also preview the exact area outline (like Google&rsquo;s boundary) when you search.
        </p>
      ) : null}
    </APIProvider>
  );
}
