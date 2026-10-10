import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { similarProperties } from '../../../services/propertyService.js';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';
import { CARD_SIZES } from '../../../lib/imgSrcSet.js';
import { useNearViewport } from '../../../lib/useNearViewport.js';
import { propertyHref } from '../../../lib/listingSeo.js';

export function SimilarProperties({ p }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const secRef = useRef(null);
  const sentinelRef = useRef(null);
  const near = useNearViewport(sentinelRef, '600px');
  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    similarProperties({
      deal: p.deal, locality: p.localitySlug, bhk: p.bhkNum, price: p.price, lat: p.lat, lng: p.lng, exclude: p.uuid || p.id,
    })
      .then((rows) => { if (alive) setItems(rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [near, p.id, p.uuid, p.deal, p.localitySlug, p.bhkNum, p.price, p.lat, p.lng]);

  // This section mounts asynchronously (after the parent's scroll-reveal observer
  // has already scanned the page), so reveal it directly once the cards render.
  useEffect(() => {
    if (items.length && secRef.current) secRef.current.classList.add('visible');
  }, [items]);

  if (!items.length) return <div ref={sentinelRef} aria-hidden="true" />;
  return (
    <section ref={secRef} className="fade-in">
      <MobileCollapse
        label={t('property.similarProperties')}
        summary={String(items.length)}
        header={<h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="layout-grid" className="w-5 h-5 text-brand-teal-2" /> {t('property.similarProperties')}</h2>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((x) => {
            const rent = x.deal === 'rent';
            return (
              <Link key={x.id} to={propertyHref(x)} className="property-card group rounded-2xl overflow-hidden block">
                <div className="card-img relative h-48">
                  <PropertyImage src={x.image} sizes={CARD_SIZES} alt={x.title} loading="lazy" className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3">{x.ownerVerified ? <span className="tag tag-teal text-xs">{t('property.similarVerified')}</span> : x.rera ? <span className="tag tag-coral text-xs">RERA</span> : <span className="tag tag-indigo text-xs">{t('property.similarPremium')}</span>}</div>
                </div>
                <div className="p-5">
                  <h3 className="font-bold text-white text-lg mb-1 group-hover:text-brand-teal-3 transition-smooth truncate">{x.title}</h3>
                  <div className="flex items-center gap-1.5 text-slate-400 text-sm mb-3"><Icon name="map-pin" className="w-3.5 h-3.5 text-brand-teal-2" /> {x.locality}, {cityLabelFor(x)}{Number.isFinite(x._km) && x._km >= 0.3 ? <span className="text-slate-500">· {x._km < 1 ? t('property.mAwayShort', { m: Math.round(x._km * 1000) }) : t('property.kmAwayShort', { km: x._km.toFixed(1) })}</span> : null}</div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xl font-extrabold gradient-text">{rent ? '₹' + fmtNum(x.price) + '/mo' : fmtINR(x.price)}</span>
                    <span className="text-xs text-slate-500">{fmtNum(x.area)} sq.ft.</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-400 border-t border-white/5 pt-3">
                    <span className="flex items-center gap-1"><Icon name="bed-double" className="w-3.5 h-3.5" /> {x.bhk}</span>
                    <span className="flex items-center gap-1"><Icon name="building" className="w-3.5 h-3.5" /> {x.type}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </MobileCollapse>
    </section>
  );
}
