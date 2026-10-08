import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { commuteInfo } from './locationIntel.js';
import { propertyKind } from './derivations.js';
import { useLocalityStats, localitySlugOf } from './useLocalityStats.js';
import { fmtNum } from '../../../lib/format.js';

// Commute is served from the cache-at-write flow (traffic-aware "live" times when available; a free-flow estimate
// otherwise). The locality line is listing-derived and each figure is hidden when the server has none.
export default function LocationInsights({ p, lat, lng }) {
  const { t } = useTranslation();
  const agoLabel = (ts) => {
    const h = Math.max(1, Math.round((Date.now() - ts) / 3600e3));
    return h < 24 ? t('property.agoHours', { count: h }) : t('property.agoDays', { count: Math.round(h / 24) });
  };
  const commute = useMemo(() => commuteInfo(lat, lng), [lat, lng]);
  const slug = localitySlugOf(p);
  const loc = useLocalityStats(p);
  const isCommercial = propertyKind(p) === 'commercial';

  if (!commute.legs.length && !loc) return null;

  return (
    <div className="mt-4 space-y-4">

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

      {loc && (loc.avgRent != null || loc.ratePerSqft != null || loc.liveListings > 0) ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400" data-testid="location-locality-stats">
          {loc.ratePerSqft != null ? <span className="inline-flex items-center gap-1.5"><Icon name="ruler" className="w-3.5 h-3.5 text-brand-teal-3" /> Avg <span className="font-semibold text-white">₹{fmtNum(loc.ratePerSqft)}</span>/sq.ft.</span> : null}
          {loc.avgRent != null ? <span className="inline-flex items-center gap-1.5"><Icon name="indian-rupee" className="w-3.5 h-3.5 text-brand-teal-3" /> Avg rent <span className="font-semibold text-white">₹{fmtNum(loc.avgRent)}</span>/mo</span> : null}
          {loc.liveListings > 0 ? <span className="inline-flex items-center gap-1.5"><Icon name="home" className="w-3.5 h-3.5 text-brand-teal-3" /> <span className="font-semibold text-white">{loc.liveListings}</span> {loc.liveListings > 1 ? 'homes' : 'home'} listed</span> : null}
        </div>
      ) : null}
      <Link to={`/locality/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal-3 hover:underline">
        {t('property.viewLocalityInsights', { locality: p.locality })} <Icon name="arrow-right" className="w-4 h-4" />
      </Link>
    </div>
  );
}
