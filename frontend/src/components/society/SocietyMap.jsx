import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../../lib/mapsConfig.js';
import MapUnavailable from '../property/MapUnavailable.jsx';

/* Read-only single-pin map for the Society hub. Reuses the same Google SDK,
   dark styling and MapUnavailable fallback as PropertyMap / LocationPicker, but
   without the listing-shaped props — it just drops one branded pin at the
   society's coordinates. When no Maps key is configured it degrades to the
   shared placeholder so the surrounding card stays intact. */
export default function SocietyMap({ lat, lng, name, height = 220 }) {
  const { t } = useTranslation();
  const wrapStyle = { height, minHeight: height };
  if (lat == null || lng == null) return <MapUnavailable style={wrapStyle} note={t('societyMap.notSet')} />;
  if (!GOOGLE_MAPS_API_KEY) return <MapUnavailable style={wrapStyle} />;
  const position = { lat, lng };
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div className="w-full rounded-2xl overflow-hidden border border-white/10 isolate relative" style={wrapStyle}>
        <Map
          mapId={GOOGLE_MAPS_MAP_ID}
          colorScheme="DARK"
          defaultCenter={position}
          defaultZoom={15}
          gestureHandling="greedy"
          clickableIcons={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          zoomControl={false}
          cameraControl={false}
          rotateControl={false}
          scaleControl={false}
          keyboardShortcuts={false}
          style={{ width: '100%', height: '100%' }}
        >
          <AdvancedMarker position={position} title={name || t('societyMap.pinTitle')}>
            <div className="lp-pin"><span className="lp-pin__dot" /></div>
          </AdvancedMarker>
        </Map>
      </div>
    </APIProvider>
  );
}
