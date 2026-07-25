import { useEffect, useRef, useCallback, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../../../lib/mapsConfig.js';
import MapUnavailable from '../../../components/property/MapUnavailable.jsx';

/* Google Maps location picker for the List-Property flows. A draggable branded
   pin the owner drops on the exact spot; clicking the map moves the pin too.
   `flyTo` ([lat,lng]) recenters after a locality pick / area search. Replaces the
   old Leaflet MapContainer + MapInner. Emits pin position via `onMove(lat,lng)`.
   All default map chrome (view toggle, zoom, Street View, fullscreen, rotate) is
   hidden so it reads as a clean pin-drop canvas — panning/zooming stays available
   via gestures (scroll / pinch / drag). */

// vis.gl map clicks expose a plain literal at e.detail.latLng; AdvancedMarker
// drag events carry a raw google LatLng (lat()/lng() methods). Read both.
function readLatLng(e) {
  const ll = (e && e.detail && e.detail.latLng) || (e && e.latLng) || null;
  if (!ll) return null;
  const lat = typeof ll.lat === 'function' ? ll.lat() : ll.lat;
  const lng = typeof ll.lng === 'function' ? ll.lng() : ll.lng;
  return lat == null || lng == null ? null : [lat, lng];
}

// Static — vis.gl re-runs setOptions when style/props change identity, so hoist.
const MAP_STYLE = { width: '100%', height: '100%' };

function Recenter({ flyTo }) {
  const map = useMap();
  const lat = flyTo ? flyTo[0] : null;
  const lng = flyTo ? flyTo[1] : null;
  useEffect(() => {
    if (!map || lat == null || lng == null) return;
    map.setCenter({ lat, lng });
    map.setZoom(15);
  }, [map, lat, lng]);
  return null;
}

export default function LocationPicker({ lat, lng, flyTo, onMove }) {
  const { t } = useTranslation();
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const move = useCallback((e) => {
    const p = readLatLng(e);
    if (p) onMoveRef.current(p[0], p[1]);
  }, []);
  const position = useMemo(() => ({ lat, lng }), [lat, lng]);
  if (!GOOGLE_MAPS_API_KEY) return <MapUnavailable style={{ height: '100%' }} note={t('listProperty.locationPicker.unavailable')} />;
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <Map
        mapId={GOOGLE_MAPS_MAP_ID}
        colorScheme="DARK"
        defaultCenter={position}
        defaultZoom={13}
        gestureHandling="greedy"
        clickableIcons={false}
        disableDefaultUI
        mapTypeControl={false}
        zoomControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        rotateControl={false}
        scaleControl={false}
        keyboardShortcuts={false}
        onClick={move}
        style={MAP_STYLE}
      >
        <Recenter flyTo={flyTo} />
        <AdvancedMarker position={position} draggable onDragEnd={move}>
          <div className="lp-pin"><span className="lp-pin__dot" /></div>
        </AdvancedMarker>
      </Map>
    </APIProvider>
  );
}
