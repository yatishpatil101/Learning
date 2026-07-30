import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { commuteInfo, connectivityFor, livabilityFor } from './locationIntel.js';
import { propertyKind } from './derivations.js';
import { LOC } from '../../../data/localityIntel.js';
import { countProperties } from '../../../services/propertyService.js';

// Rich Location-tab content: commute-to-work, nearby landmarks and livability.
// Commute is served from the cache-at-write flow (traffic-aware "live" times when
// available; a free-flow estimate otherwise). Nearby + livability stay curated.
// Sections self-hide when the property's locality has no data, so there is never
// an empty band.
export default function LocationInsights({ p, lat, lng }) {
  const { t } = useTranslation();
  // Relative "updated Xh ago" label for the live-commute freshness pill.
  const agoLabel = (ts) => {
    const h = Math.max(1, Math.round((Date.now() - ts) / 3600e3));
    return h < 24 ? t('property.agoHours', { count: h }) : t('property.agoDays', { count: Math.round(h / 24) });
  };
  const commute = useMemo(() => commuteInfo(lat, lng), [lat, lng]);
  const nearby = useMemo(() => connectivityFor(p), [p]);
  const liv = useMemo(() => livabilityFor(p), [p]);
  const slug = p.localitySlug || (p.locality || '').toLowerCase().replace(/\s+/g, '-');
  // Locality snapshot: curated price/appreciation (when the area has a dashboard)
  // plus live supply — so the number is on the tab, not one click away.
  const li = LOC[p.locality] || null;
  const [homes, setHomes] = useState(null);
  useEffect(() => {
    let alive = true;
    // Only the number is rendered, so ask the server to count rather than shipping the catalogue
    // here to measure it — `countProperties` stays exact once Pune outgrows a single page.
    countProperties({ locality: slug }).then((n) => { if (alive) setHomes(n); });
    return () => { alive = false; };
  }, [slug]);
  // A commercial unit IS the workplace, so "commute to work" is the wrong frame —
  // the same drive-time-to-hubs data reads as business-hub connectivity instead.
  const isCommercial = propertyKind(p) === 'commercial';

  if (!commute.legs.length && !nearby.length && !liv) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* COMMUTE TO WORK (residential) / BUSINESS-HUB CONNECTIVITY (commercial) */}
      {commute.legs.length ? (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <Tip k={isCommercial ? 'location.commuteBiz' : 'location.commute'}>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Icon name="briefcase" className="w-4 h-4 text-brand-teal-3" /> {isCommercial ? t('property.commuteBiz') : t('property.commute')}
              </h3>
            </Tip>
            {commute.source === 'live' ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-teal-3">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-teal-2 animate-pulse" /> {t('property.liveTrafficUpdated', { ago: agoLabel(commute.fetchedAt) })}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">{t('property.approxByRoad')}</span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {commute.legs.map((c) => (
              <div key={c.name} className="rd-cell">
                <div className="rd-lbl truncate">{c.name}</div>
                <div className="rd-val flex items-baseline gap-1">{c.min}<span className="text-[11px] font-medium text-slate-400">{t('property.minShort')}</span></div>
                <div className="text-[11px] text-slate-500 mt-0.5">{t('property.kmDrive', { km: c.km })}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* NEARBY LANDMARKS & CONNECTIVITY */}
      {nearby.length ? (
        <div>
          <Tip k="location.nearby">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2.5">
              <Icon name="map-pinned" className="w-4 h-4 text-brand-teal-3" /> {t('property.whatsNearby')}
            </h3>
          </Tip>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {nearby.map((n) => (
              <div key={n.name} className="detail-card">
                <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                  <Icon name={n.icon} className="w-4 h-4 text-brand-teal-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">{n.name}</div>
                  <div className="text-[11px] text-slate-500">{n.cat}</div>
                </div>
                <span className="text-xs font-semibold text-brand-teal-3 flex-shrink-0">{n.dist}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* LIVABILITY */}
      {liv ? (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <Tip k="location.livability">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Icon name="star" className="w-4 h-4 text-brand-teal-3" /> {t('property.livability')}
              </h3>
            </Tip>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-teal-3">
              <span className="text-white font-bold">{liv.score}</span>/10 · {liv.scoreLabel}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {liv.bars.map((b) => (
              <div key={b.label} className="rd-cell">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-300">{b.label}</span>
                  <span className="text-xs font-bold text-white">{b.value}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-teal-2" style={{ width: `${b.value * 10}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Locality snapshot + deep-link to the full locality insights page */}
      {li || homes ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
          {li ? <span className="inline-flex items-center gap-1.5"><Icon name="ruler" className="w-3.5 h-3.5 text-brand-teal-3" /> Avg <span className="font-semibold text-white">₹{li.price.toLocaleString('en-IN')}</span>/sq.ft.</span> : null}
          {li ? <span className="inline-flex items-center gap-1.5"><Icon name="trending-up" className="w-3.5 h-3.5 text-emerald-400" /> <span className="font-semibold text-emerald-400">+{li.yoy}%</span> YoY</span> : null}
          {homes ? <span className="inline-flex items-center gap-1.5"><Icon name="home" className="w-3.5 h-3.5 text-brand-teal-3" /> <span className="font-semibold text-white">{homes}</span> {homes > 1 ? 'homes' : 'home'} listed</span> : null}
        </div>
      ) : null}
      <Link to={`/locality/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal-3 hover:underline">
        {t('property.viewLocalityInsights', { locality: p.locality })} <Icon name="arrow-right" className="w-4 h-4" />
      </Link>
    </div>
  );
}
