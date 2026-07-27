import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { featuredProperties } from '../../../services/propertyService.js';
import { priceLabel } from '../../../lib/format.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { isSavedProp, toggleSavedProp } from '../../../lib/store.js';
import { verifiedStats } from '../../../lib/mockApi.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';

const specs = (p) => {
  const out = [];
  if (p.bhkNum) out.push(p.bhk);
  if (p.area) out.push(`${Number(p.area).toLocaleString('en-IN')} sq.ft.`);
  if (p.type) out.push(p.type);
  return out.slice(0, 3);
};

/* Single featured card. Owns its saved state so the heart is a real bookmark
   (mirrors the listings Card): guests are sent to sign-in, members toggle the
   saved store that the navbar heart-count reads. */
function FeaturedCard({ p }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isIn } = useAuth();
  const [saved, setSaved] = useState(() => isSavedProp(p.id));

  const handleSave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isIn) { navigate('/signin?reason=save&next=/'); return; }
    setSaved(toggleSavedProp(p.id));
  };

  return (
    <Link to={`/property/${p.id}`} className="property-card list-reveal glass rounded-2xl overflow-hidden group cursor-pointer flex flex-col">
      <div className="card-img-wrap relative overflow-hidden" style={{ aspectRatio: '16/10' }}>
        <img src={p.image || p.img} alt={p.title} width={600} height={400} className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {(p.ownerVerified || p.ownershipVerified) && (
            <span className="w-7 h-7 rounded-lg bg-black/50 backdrop-blur-sm text-emerald-300 border border-emerald-500/20 inline-flex items-center justify-center" title={t('home.featured.verified')}>
              <Icon name="shield-check" className="w-4 h-4" />
            </span>
          )}
        </div>
        <button
          className={'absolute top-3 right-3 w-9 h-9 rounded-lg backdrop-blur-sm border flex items-center justify-center transition-all ' + (saved ? 'bg-rose-500/90 border-rose-400/40 text-white' : 'bg-black/40 border-white/10 text-white hover:bg-black/60')}
          onClick={handleSave}
          aria-pressed={saved}
          aria-label={saved ? t('home.featured.removeSaved') : t('home.featured.saveProperty')}
        >
          <Icon name="heart" className={'w-4 h-4' + (saved ? ' fill-current' : '')} />
        </button>
        <div className="absolute bottom-3 left-3">
          <span className="text-xl font-extrabold text-white tabular-nums" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{priceLabel(p)}</span>
          {p.deal === 'rent' && <span className="text-xs text-gray-300 ml-1">{t('home.featured.perMonth')}</span>}
        </div>
      </div>
      <div className="flex flex-col flex-1 p-4 gap-1.5">
        <h3 className="font-semibold text-sm leading-snug text-white group-hover:text-teal-300 transition-colors line-clamp-2">{p.title}</h3>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Icon name="map-pin" className="w-3.5 h-3.5 text-gray-600 shrink-0" /> {p.locality}, {cityLabelFor(p)}
        </div>
        <div className="mt-auto pt-3 border-t border-white/5 flex items-center gap-3 text-xs text-gray-400">
          {specs(p).map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="w-px h-3 bg-gray-700" />}
              {s}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

/* Home "Featured properties" rail — data-driven off the real catalogue.
   Featured is a paid promotion slot (admins + paid owners flag a listing), so we
   pull `featuredProperties()` (promoted first, padded with fresh approved stock). */
export default function Featured({ navigate }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // E1 (ADR-019): honest verified-supply social proof. Mock-computed today; a backend
  // aggregate later. Best-effort — if the mock isn't reachable (http mode) we just hide it.
  const [vstats, setVstats] = useState(null);

  useEffect(() => {
    let alive = true;
    featuredProperties(6)
      .then((rows) => { if (alive) { setItems(rows); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    try { const s = verifiedStats(); if (s && s.verifiedListings > 0) setVstats(s); } catch { /* mock unavailable */ }
    return () => { alive = false; };
  }, []);

  // Once the fetch settles with no promoted/approved stock there is nothing to
  // feature — drop the whole rail rather than show an empty heading.
  if (!loading && !items.length) return null;

  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8 list-reveal">
          <div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2">{t('home.featured.title')}</h2>
            <p className="text-gray-400 text-sm sm:text-base">{t('home.featured.subtitle')}</p>
            {vstats && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-emerald-300/90">
                <Icon name="shield-check" className="w-4 h-4" />
                {t('home.featured.verifiedProof', { listings: vstats.verifiedListings, owners: vstats.verifiedOwners })}
              </p>
            )}
          </div>
          <button onClick={() => navigate('/listings')} className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[#14b8a6] hover:text-[#2dd4bf] transition-colors group">
            {t('home.featured.viewAll')} <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass rounded-2xl overflow-hidden" aria-hidden="true">
                  <div className="skeleton" style={{ aspectRatio: '16/10' }} />
                  <div className="p-4 space-y-3">
                    <div className="h-4 w-2/3 skeleton rounded" />
                    <div className="h-3 w-1/2 skeleton rounded" />
                    <div className="h-3 w-3/4 skeleton rounded" />
                  </div>
                </div>
              ))
            : items.map((p) => <FeaturedCard key={p.id} p={p} />)}
        </div>

        {/* Mobile keeps an in-section path to the full catalogue (the header
           "View All" is desktop-only to avoid crowding the heading row). */}
        {!loading && (
          <button
            onClick={() => navigate('/listings')}
            className="sm:hidden mt-6 w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-[#14b8a6] hover:bg-white/10 hover:text-[#2dd4bf] transition-all"
          >
            {t('home.featured.viewAllProperties')} <Icon name="arrow-right" className="w-4 h-4" />
          </button>
        )}
      </div>
    </section>
  );
}
