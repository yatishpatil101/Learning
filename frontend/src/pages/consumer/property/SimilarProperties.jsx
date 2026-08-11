import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import { listProperties } from '../../../services/propertyService.js';
import { localityBySlug } from '../../../data/localities.js';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';

const LIMIT = 3;
const RADIUS_KM = 6;      // "nearby" = same + adjacent Pune localities
const BHK_TOL = 1;        // similar configuration
const PRICE_LOW = 0.6;    // similar budget band
const PRICE_HIGH = 1.6;

// Resolve a listing's coordinates: its own pin first, else the centre of its
// canonical locality (seeded from Google). Null when neither is known.
function coordsOf(x) {
  if (typeof x.lat === 'number' && typeof x.lng === 'number') return [x.lat, x.lng];
  const loc = localityBySlug(x.localitySlug);
  if (loc && loc.lat != null && loc.lng != null) return [loc.lat, loc.lng];
  return null;
}

function distKm(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function SimilarProperties({ p }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const secRef = useRef(null);
  useEffect(() => {
    let alive = true;
    // Same deal only (never mix buy with rent) — buyers/renters want like-for-like.
    //
    // Ask for the listing's own locality first: that is where almost every genuinely "similar
    // nearby" home is, and it keeps the request proportional to one area rather than the whole
    // market. The tiers below deliberately fall back to *nearest overall* when an area is thin, so
    // the second, unscoped fetch runs only when the locality alone cannot fill the strip.
    const candidates = async () => {
      if (!p.localitySlug) return listProperties({ deal: p.deal });
      const local = await listProperties({ deal: p.deal, locality: p.localitySlug });
      if (local.filter((x) => x.id !== p.id).length >= LIMIT) return local;
      return listProperties({ deal: p.deal });
    };
    candidates().then((list) => {
      if (!alive) return;
      const origin = coordsOf(p);
      const cands = list
        .filter((x) => x.id !== p.id)
        .map((x) => ({ x, km: distKm(origin, coordsOf(x)) }));

      const bhkOk = (x) => Math.abs((x.bhkNum || 0) - (p.bhkNum || 0)) <= BHK_TOL;
      const priceOk = (x) => {
        if (!p.price || !x.price) return true;
        return x.price >= p.price * PRICE_LOW && x.price <= p.price * PRICE_HIGH;
      };

      // Tier 1: genuinely nearby AND similar (config + budget). This is the ideal set.
      const ideal = cands
        .filter((c) => c.km <= RADIUS_KM && bhkOk(c.x) && priceOk(c.x))
        .sort((a, b) => a.km - b.km || Math.abs((a.x.price || 0) - (p.price || 0)) - Math.abs((b.x.price || 0) - (p.price || 0)));

      const picked = [...ideal];
      const has = (id) => picked.some((c) => c.x.id === id);

      // Tier 2 (top-up): still nearby, relax config/budget — keeps the "nearby" promise.
      if (picked.length < LIMIT) {
        cands
          .filter((c) => c.km <= RADIUS_KM && !has(c.x.id))
          .sort((a, b) => a.km - b.km)
          .forEach((c) => { if (picked.length < LIMIT) picked.push(c); });
      }
      // Tier 3 (last resort): nearest listings by distance so we never show random,
      // far, or wildly-priced properties like before — closest available wins.
      if (picked.length < LIMIT) {
        cands
          .filter((c) => !has(c.x.id))
          .sort((a, b) => a.km - b.km)
          .forEach((c) => { if (picked.length < LIMIT) picked.push(c); });
      }

      setItems(picked.slice(0, LIMIT).map((c) => ({ ...c.x, _km: c.km })));
    });
    return () => { alive = false; };
  }, [p.id, p.deal, p.localitySlug, p.bhkNum, p.price, p.lat, p.lng]);

  // This section mounts asynchronously (after the parent's scroll-reveal observer
  // has already scanned the page), so reveal it directly once the cards render.
  useEffect(() => {
    if (items.length && secRef.current) secRef.current.classList.add('visible');
  }, [items]);

  if (!items.length) return null;
  return (
    <section ref={secRef} className="fade-in">
      {/* Collapsed on phones (D141), and deliberately the *first* block chosen for it:
         at ~380px per stacked card this is the single tallest thing on the page, it
         renders under every tab, and its whole purpose is to take the visitor away
         from the listing they asked for. Nothing on it can be part of "is this the
         right place". The match count is the summary so the strip still advertises
         itself. Desktop keeps the three-up row exactly as before. */}
      <MobileCollapse
        headerClassName="mb-6"
        label={t('property.similarProperties')}
        summary={String(items.length)}
        header={<h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="layout-grid" className="w-5 h-5 text-brand-teal-2" /> {t('property.similarProperties')}</h2>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((x) => {
            const rent = x.deal === 'rent';
            const baths = x.bhkNum ? Math.max(1, x.bhkNum - 1) : 1;
            return (
              <Link key={x.id} to={`/property/${x.id}`} className="property-card group rounded-2xl overflow-hidden block">
                <div className="card-img relative h-48">
                  <img src={x.image} alt={x.title} loading="lazy" className="w-full h-full object-cover" />
                  <div className="absolute top-3 left-3">{x.ownerVerified ? <span className="tag tag-teal text-xs">{t('property.similarVerified')}</span> : x.rera ? <span className="tag tag-coral text-xs">RERA</span> : <span className="tag tag-indigo text-xs">{t('property.similarPremium')}</span>}</div>
                  <div className="absolute top-3 right-3"><span className="tag text-xs flex items-center gap-1"><Icon name="camera" className="w-3 h-3" /> {(x.gallery || []).length || 1}</span></div>
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
                    <span className="flex items-center gap-1"><Icon name="bath" className="w-3.5 h-3.5" /> {baths}</span>
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
