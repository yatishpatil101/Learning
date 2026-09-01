import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { getProperty } from '../../../services/propertyService.js';
import { getRecentProps } from '../../../lib/localPrefs.js';
import { priceLabel } from '../../../lib/format.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';

/* "Recently viewed" rail — a return-visitor convenience. Reads the per-user MRU
   list of property ids this browser keeps and resolves them to cards. Renders
   nothing on a first visit (empty list), so it never adds noise for new users. */
export default function RecentlyViewed() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    const ids = getRecentProps().slice(0, 4);
    if (!ids.length) return undefined;
    Promise.all(ids.map((id) => getProperty(id).catch(() => null))).then((rows) => {
      if (alive) setItems(rows.filter(Boolean));
    });
    return () => { alive = false; };
  }, []);

  if (!items.length) return null;

  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="section-head flex items-end justify-between sm:mb-6 reveal">
          <div>
            <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-1.5">{t('home.recent.eyebrow')}</p>
            <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Icon name="history" className="w-6 h-6 text-teal-400" /> {t('home.recent.title')}
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 reveal">
          {items.map((p) => (
            <Link key={p.id} to={`/property/${p.id}`} className="property-card glass rounded-2xl overflow-hidden group flex flex-col">
              <div className="relative overflow-hidden" style={{ aspectRatio: '16/10' }}>
                <PropertyImage src={p.image || p.img} alt={p.title} width={400} height={250} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-2 left-2.5 text-sm font-extrabold text-white tabular-nums" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{priceLabel(p)}</span>
              </div>
              <div className="p-3">
                <h3 className="text-xs font-semibold text-white leading-snug line-clamp-1 group-hover:text-teal-300 transition-colors">{p.title}</h3>
                <p className="flex items-center gap-1 text-[11px] text-gray-500 mt-1">
                  <Icon name="map-pin" className="w-3 h-3 text-gray-600 shrink-0" /> {p.locality}, {cityLabelFor(p)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
