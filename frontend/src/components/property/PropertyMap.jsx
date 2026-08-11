import { useEffect, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import PropertyImage from '../ui/PropertyImage.jsx';
import '../../styles/routes/property-map.css';
import { fmtINR } from '../../lib/format.js';
import { SHARING_LBL, FURN_LBL } from '../../pages/consumer/listings/constants.js';
import { propLatLng } from '../../pages/consumer/listings/geo.js';
import { POSSESSION, AMEN_ICON, amenLabel } from './tileMeta.js';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../../lib/mapsConfig.js';
import { getActiveCityGeo, cityLabelFor } from '../../lib/geoConfig.js';
import MapUnavailable from './MapUnavailable.jsx';

const mapLabel = (m) => (m.deal === 'rent' ? '₹' + Math.round(m.price / 1000) + 'k' : m.price >= 1e7 ? '₹' + (m.price / 1e7).toFixed(2) + 'Cr' : '₹' + Math.round(m.price / 1e5) + 'L');
const MAX_AMEN_CHIPS = 5;
const IW_OFFSET = [0, -42]; // stable identity so vis.gl doesn't re-run setOptions each render

// Same title the standard tile (Card.jsx) shows, so the popup reads identically.
const popupTitle = (p) => {
  if (p.shareType === 'pg') return 'PG / Hostel';
  if (p.shareType === 'flatmates') return 'Flatmate / Shared';
  const t = (p.type || '').toLowerCase();
  if (['plot', 'open plot', 'farm land'].includes(t)) return p.type && t !== 'plot' ? p.type : 'Residential Plot';
  return p.bhkNum ? `${p.bhkNum} BHK ${p.type}` : p.type;
};

// Compact key-facts for the tile grid — mirrors the reference tile's attribute
// grid, adapted to what each listing kind actually has (no invented fields).
const buildFacts = (p, isPg, isPlot, baths, shareText) => {
  const area = p.area ? p.area.toLocaleString('en-IN') + ' sq.ft' : '';
  const furn = FURN_LBL[p.furnishing];
  const possession = POSSESSION[p.construction];
  const facts = [];
  if (isPg) {
    facts.push({ icon: 'users', value: shareText, label: 'Sharing' });
    if (area) facts.push({ icon: 'maximize-2', value: area, label: 'Built-up' });
    if (furn) facts.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
  } else if (isPlot) {
    if (area) facts.push({ icon: 'maximize-2', value: area, label: 'Plot area' });
    if (p.type) facts.push({ icon: 'building-2', value: p.type, label: 'Land type' });
  } else {
    if (p.bhkNum) facts.push({ icon: 'bed-double', value: p.bhkNum + ' Bed', label: 'Bedrooms' });
    if (p.type) facts.push({ icon: 'building-2', value: p.type, label: 'Property type' });
    if (baths) facts.push({ icon: 'bath', value: baths + ' Bath', label: 'Bathrooms' });
    if (furn) facts.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
    if (area) facts.push({ icon: 'maximize-2', value: area, label: 'Built-up' });
  }
  if (possession) facts.push({ icon: 'calendar', value: possession, label: 'Possession' });
  return facts;
};

// Keeps the target marker in the visible part of the map. On the listings map a
// detail drawer covers the right (desktop) / bottom (mobile), so we shift the pin
// clear of it (offset=true). On the single-property page there's no drawer, so the
// pin should sit dead-centre (offset=false).
function PanToActive({ lat, lng, offset = true }) {
  const map = useMap();
  useEffect(() => {
    if (!map || lat == null || lng == null) return;
    map.panTo({ lat, lng });
    if (!offset) return;
    const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;
    map.panBy(wide ? 190 : 0, wide ? 0 : -140);
  }, [lat, lng, map, offset]);
  return null;
}

// Fits the listings map to its content: the property markers when there are any,
// otherwise the selected localities' registry centres. Without this the map sat at
// the city default, so a locality with few/zero listings opened unfocused (looked
// broken). Keyed off the content signature only — a marker click (which sets an
// active property, handled by PanToActive) must not trigger a refit.
function FitToContent({ positions, focus, active }) {
  const map = useMap();
  const sig = positions.map((p) => p.join(',')).join('|') + '::' + focus.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (!map || active) return; // an active property is centred by PanToActive
    const g = typeof window !== 'undefined' ? window.google : null;
    if (!g || !g.maps) return;
    const pts = positions.length ? positions : focus;
    if (!pts.length) return;
    if (pts.length === 1) {
      map.panTo({ lat: pts[0][0], lng: pts[0][1] });
      map.setZoom(14);
      return;
    }
    const bounds = new g.maps.LatLngBounds();
    pts.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
    map.fitBounds(bounds, 72);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
  return null;
}

// Rich map tile shown inside a map InfoWindow. Only used on the single-property
// mini-map (Property page). On the listings map, clicking a marker opens the
// detail drawer directly, so no InfoWindow is rendered there.
function PropertyPopup({ p, locName }) {
  const { t } = useTranslation();
  const isRent = p.deal === 'rent';
  const isPg = p.shareType === 'pg' || p.shareType === 'flatmates';
  const isPlot = ['plot', 'open plot', 'farm land'].includes((p.type || '').toLowerCase());
  const baths = Number(p.bath) || 0;
  const shareKeys = Array.isArray(p.sharing) ? p.sharing : (p.sharing ? [p.sharing] : []);
  const shareText = shareKeys.length ? (SHARING_LBL[shareKeys[0]] || 'Sharing') + (shareKeys.length > 1 ? ` +${shareKeys.length - 1}` : '') : 'Sharing';
  const verified = p.ownerVerified || p.ownershipVerified;
  const loc = (locName && locName[p.localitySlug]) || p.locality;
  const facts = buildFacts(p, isPg, isPlot, baths, shareText);
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const amenShown = amenities.slice(0, MAX_AMEN_CHIPS);
  const amenMore = amenities.length - amenShown.length;
  return (
    <div className="pn-mp-card">
      <div className="pn-mp-media">
        <PropertyImage src={p.image} alt={p.title} loading="lazy" />
        <span className={'pn-mp-deal ' + (isRent ? 'is-rent' : 'is-sale')}>{isRent ? 'Rent' : 'Sale'}</span>
        {verified ? <span className="pn-mp-verified" title={t('pmap.verified')}><Icon name="badge-check" /></span> : null}
      </div>
      <div className="pn-mp-body">
        <div className="pn-mp-title">{popupTitle(p)}</div>
        <div className="pn-mp-price">
          {isRent ? <>₹{(p.price || 0).toLocaleString('en-IN')}<span>/mo</span></> : fmtINR(p.price)}
        </div>
        <div className="pn-mp-loc"><Icon name="map-pin" /> {loc}, {cityLabelFor(p)}</div>
        {facts.length ? (
          <div className="pn-mp-facts">
            {facts.map((fct, i) => (
              <div className="pn-mp-fact" key={i}>
                <Icon name={fct.icon} />
                <div>
                  <b>{fct.value}</b>
                  <span>{fct.label}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {amenShown.length ? (
          <div className="pn-mp-amen">
            <div className="pn-mp-amen-hd">{t('pmap.amenities')}</div>
            <div className="pn-mp-chips">
              {amenShown.map((k) => (
                <span className="pn-mp-chip" key={k}><Icon name={AMEN_ICON[k] || 'check'} /> {amenLabel(k)}</span>
              ))}
              {amenMore > 0 ? <span className="pn-mp-chip is-more">+{amenMore}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PropertyMap({ properties, locName, focus = [], activeId, onSelect, wrapStyle: wrapStyleProp }) {
  const [openId, setOpenId] = useState(null); // single-property InfoWindow (no onSelect)
  // Single-property mode (Property details page): one pin, no listings drawer.
  const single = !onSelect && properties.length === 1;
  const activeIdx = properties.findIndex((p) => p.id === activeId);
  const activePos = activeIdx >= 0 ? propLatLng(properties[activeIdx]) : (single ? propLatLng(properties[0]) : null);
  const openProp = !onSelect && openId ? properties.find((p) => p.id === openId) : null;
  const openPos = openProp ? propLatLng(openProp) : null;
  const cityCenter = getActiveCityGeo().center;
  // In single-property mode centre the map on the property from the first paint so
  // the pin is already dead-centre. With no markers but an explicit focus point
  // (e.g. an emerging-locality map card) centre on that from birth, so the map is
  // never left at the world/zero view when there's nothing for FitToContent to fit.
  const focusCenter = properties.length === 0 && focus.length === 1 ? { lat: focus[0][0], lng: focus[0][1] } : null;
  const initialCenter = single && activePos ? { lat: activePos[0], lng: activePos[1] } : (focusCenter || cityCenter);
  const initialZoom = single ? 15 : (focusCenter ? 14 : 12);
  // Callers can hand an explicit footprint (e.g. an embedded locality map card);
  // otherwise fall back to the mode's default height.
  const wrapStyle = wrapStyleProp || (single ? { height: '100%' } : { height: '72vh', minHeight: 520 });
  if (!GOOGLE_MAPS_API_KEY) return <MapUnavailable style={wrapStyle} />;
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div className="w-full rounded-2xl overflow-hidden border border-white/10 isolate relative" style={wrapStyle}>
        <Map
          mapId={GOOGLE_MAPS_MAP_ID}
          colorScheme="DARK"
          defaultCenter={initialCenter}
          defaultZoom={initialZoom}
          gestureHandling="greedy"
          clickableIcons={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          zoomControl={!single}
          cameraControl={!single}
          rotateControl={!single}
          scaleControl={!single}
          keyboardShortcuts={!single}
          onClick={() => setOpenId(null)}
          style={{ width: '100%', height: '100%' }}
        >
          <PanToActive lat={activePos ? activePos[0] : null} lng={activePos ? activePos[1] : null} offset={!single} />
          {!single ? <FitToContent positions={properties.map((p) => propLatLng(p))} focus={focus} active={!!activePos} /> : null}
          {properties.map((p) => {
            const [lat, lng] = propLatLng(p);
            const active = p.id === activeId;
            return (
              <AdvancedMarker
                key={p.id}
                position={{ lat, lng }}
                zIndex={active ? 500 : undefined}
                onClick={() => (onSelect ? onSelect(p.id) : setOpenId((id) => (id === p.id ? null : p.id)))}
              >
                <div className={'price-marker' + (active ? ' is-active' : '')}>{mapLabel(p)}</div>
              </AdvancedMarker>
            );
          })}
          {openProp && openPos ? (
            <InfoWindow
              position={{ lat: openPos[0], lng: openPos[1] }}
              pixelOffset={IW_OFFSET}
              headerDisabled
              onClose={() => setOpenId(null)}
              className="pn-gm-iw pn-gm-iw-prop"
            >
              <PropertyPopup p={openProp} locName={locName} />
            </InfoWindow>
          ) : null}
        </Map>
      </div>
    </APIProvider>
  );
}
