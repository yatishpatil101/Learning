import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APIProvider, Map, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps';
import Icon from '../../../components/Icon.jsx';
import { LOCALITY_COORDS } from './constants.js';
import { inr, initials, avatarGrad, perHead, seatsLeft, allVerified, savePayload, moveInLabel } from './helpers.js';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '../../../lib/mapsConfig.js';
import { getActiveCityGeo } from '../../../lib/geoConfig.js';
import MapUnavailable from '../../../components/property/MapUnavailable.jsx';

const MAX_ROWS = 3;
const IW_OFFSET = [0, -22]; // stable identity so vis.gl doesn't re-run setOptions each render

// Maps the active tab to the kind savePayload expects, so saving from the map
// popup writes the same rich card the list cards do.
const SAVE_KIND = { groups: 'group', rooms: 'room', flatmates: 'flatmate' };

// Per-kind view model so one row renderer serves flatmates, rooms and groups.
function rowModel(tab, item, t) {
  if (tab === 'rooms') {
    return {
      prefix: 'r', title: item.society, verified: !!item.verified,
      meta: inr(item.budget) + t('shareFlat.perMonth') + ' · ' + (item.roomType || item.flatType || t('shareFlat.roomFallback')),
      thumb: item.img, avatarText: null, avatarGrad: 'from-teal-500 to-indigo-500',
    };
  }
  if (tab === 'groups') {
    const left = seatsLeft(item);
    return {
      prefix: 'g', title: item.title, verified: allVerified(item),
      meta: inr(perHead(item)) + t('shareFlat.perMonth') + ' · ' + (left > 0 ? t('shareFlat.seatsLeft', { count: left }) : t('shareFlat.full')),
      thumb: null, avatarText: null, avatarIcon: 'users-round', avatarGrad: 'from-indigo-500 to-teal-500',
    };
  }
  return {
    prefix: 's', title: item.name, verified: !!item.verified,
    meta: inr(item.budget) + t('shareFlat.perMonth') + ' · ' + moveInLabel(item.moveIn),
    thumb: null, avatarText: initials(item.name), avatarGrad: avatarGrad(item.gender),
  };
}

function PostRow({ tab, item, saved, onSave, onInterest, onRoomInterest, onJoin, interestedFor, goToPosting, locality }) {
  const { t } = useTranslation();
  const m = rowModel(tab, item, t);
  const saveKey = m.prefix + ':' + item.id;
  const isSaved = !!saved[saveKey];
  const interested = interestedFor(tab, item);

  let action;
  if (tab === 'rooms') {
    action = interested
      ? <button className="pn-sp-cta is-done" disabled><Icon name="check-check" /> {t('shareFlat.sent')}</button>
      : <button className="pn-sp-cta" onClick={() => onRoomInterest(item)}><Icon name="hand-heart" /> {t('shareFlat.message')}</button>;
  } else if (tab === 'groups') {
    const full = seatsLeft(item) <= 0;
    action = full
      ? <button className="pn-sp-cta is-off" disabled><Icon name="lock" /> {t('shareFlat.full')}</button>
      : interested
        ? <button className="pn-sp-cta is-done" disabled><Icon name="check-check" /> {item.policy === 'any' ? t('shareFlat.joined') : t('shareFlat.sent')}</button>
        : <button className="pn-sp-cta" onClick={() => onJoin(item)}><Icon name={item.policy === 'any' ? 'user-plus' : 'user-check'} /> {item.policy === 'any' ? t('shareFlat.join') : t('shareFlat.request')}</button>;
  } else {
    action = interested
      ? <button className="pn-sp-cta is-done" disabled><Icon name="check-check" /> {t('shareFlat.interested')}</button>
      : <button className="pn-sp-cta" onClick={() => onInterest(item)}><Icon name="hand-heart" /> {t('shareFlat.interest')}</button>;
  }

  return (
    <div className="pn-sp-row">
      <button type="button" className="pn-sp-rowmain" onClick={() => goToPosting(m.prefix, item.id, locality)} title={t('shareFlat.titleViewDetails')}>
        {m.thumb
          ? <img className="pn-sp-thumb" src={m.thumb} alt="" loading="lazy" />
          : <span className={'pn-sp-av bg-gradient-to-br ' + m.avatarGrad}>{m.avatarIcon ? <Icon name={m.avatarIcon} /> : m.avatarText}</span>}
        <span className="pn-sp-rowinfo">
          <span className="pn-sp-rowtitle">{m.title}{m.verified ? <Icon name="shield-check" className="pn-sp-vtick" /> : null}</span>
          <span className="pn-sp-rowmeta">{m.meta}</span>
        </span>
        <Icon name="chevron-right" className="pn-sp-chev" />
      </button>
      <div className="pn-sp-rowact">
        {action}
        <button type="button" className={'pn-sp-save' + (isSaved ? ' is-saved' : '')} aria-pressed={isSaved} aria-label={isSaved ? t('shareFlat.saved') : t('shareFlat.save')} onClick={() => onSave(saveKey, savePayload(SAVE_KIND[tab], item))}><Icon name="bookmark" /></button>
      </div>
    </div>
  );
}

// Frame the map to the localities that actually have posts: fit their bounds
// (with a little padding) when there are several, else center on the single
// area, else fall back to a Pune-wide view.
function framing(items) {
  const pts = Object.keys(items).map((l) => LOCALITY_COORDS[l]).filter(Boolean);
  if (pts.length >= 2) {
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const pad = 0.03;
    return {
      defaultBounds: {
        north: Math.max(...lats) + pad, south: Math.min(...lats) - pad,
        east: Math.max(...lngs) + pad, west: Math.min(...lngs) - pad,
      },
    };
  }
  if (pts.length === 1) return { defaultCenter: { lat: pts[0][0], lng: pts[0][1] }, defaultZoom: 13 };
  return { defaultCenter: getActiveCityGeo().center, defaultZoom: 11 };
}

function ShareMap({ items, tab, kindWord, onInterest, onRoomInterest, onJoin, onSave, saved, interestedFor, goToPosting }) {
  const { t } = useTranslation();
  const [openLoc, setOpenLoc] = useState(null);
  const hereKey = { flatmates: 'flatmatesHere', rooms: 'roomsHere', groups: 'groupsHere' }[kindWord] || 'flatmatesHere';
  const prefix = tab === 'groups' ? 'g' : tab === 'rooms' ? 'r' : 's';
  const openList = openLoc && items[openLoc] ? items[openLoc] : null;
  const openPos = openLoc ? LOCALITY_COORDS[openLoc] : null;
  if (!GOOGLE_MAPS_API_KEY) return <MapUnavailable style={{ height: 460 }} />;
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div className="sf-map w-full rounded-2xl overflow-hidden border border-white/10 isolate relative" style={{ height: 460 }}>
        <Map
          {...framing(items)}
          mapId={GOOGLE_MAPS_MAP_ID}
          colorScheme="DARK"
          gestureHandling="greedy"
          clickableIcons={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          style={{ width: '100%', height: '100%' }}
        >
          {Object.keys(items).map((l) => {
            const pos = LOCALITY_COORDS[l];
            if (!pos) return null;
            return (
              <AdvancedMarker
                key={l}
                position={{ lat: pos[0], lng: pos[1] }}
                onClick={() => setOpenLoc((cur) => (cur === l ? null : l))}
              >
                <div className="map-pin">{items[l].length}</div>
              </AdvancedMarker>
            );
          })}
          {openList && openPos ? (
            <InfoWindow
              position={{ lat: openPos[0], lng: openPos[1] }}
              pixelOffset={IW_OFFSET}
              headerDisabled
              onClose={() => setOpenLoc(null)}
              className="pn-gm-iw pn-gm-iw-share"
            >
              <div className="pn-sp">
                <div className="pn-sp-head">
                  <div className="pn-sp-title">{openLoc}</div>
                  <div className="pn-sp-sub">{t(`shareFlat.${hereKey}`, { count: openList.length })}</div>
                </div>
                <div className="pn-sp-list">
                  {openList.slice(0, MAX_ROWS).map((item) => (
                    <PostRow key={prefix + ':' + item.id} tab={tab} item={item} saved={saved} onSave={onSave} onInterest={onInterest} onRoomInterest={onRoomInterest} onJoin={onJoin} interestedFor={interestedFor} goToPosting={goToPosting} locality={openLoc} />
                  ))}
                </div>
                <button type="button" className="pn-sp-all" onClick={() => goToPosting(prefix, null, openLoc)}>
                  {openList.length > MAX_ROWS ? t('shareFlat.seeAllInLoc', { count: openList.length, loc: openLoc }) : t('shareFlat.openInList', { loc: openLoc })}
                  <Icon name="arrow-right" />
                </button>
              </div>
            </InfoWindow>
          ) : null}
        </Map>
      </div>
    </APIProvider>
  );
}

export default ShareMap;
