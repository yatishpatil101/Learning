import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { getSocietyBrief } from '../../../services/societyService.js';
import { Stars } from './Stars.jsx';

export function SocietySection({ p }) {
  const { t } = useTranslation();
  const [soc, setSoc] = useState(null);
  const socSlug = p?.societySlug || null;
  useEffect(() => {
    if (!socSlug) { setSoc(null); return undefined; }
    let alive = true;
    getSocietyBrief(socSlug)
      .then((s) => { if (alive) setSoc(s); })
      .catch(() => { if (alive) setSoc(null); });
    return () => { alive = false; };
  }, [socSlug]);

  /* No binding, no section: a heading over a generic name would still assert a society that was never picked. */
  if (!soc) return null;

  const { rating } = soc;
  const quick = [
    ['home', soc.units != null ? t('property.homesCount', { count: soc.units }) : null],
    ['building-2', soc.towers != null ? t('property.towersCount', { count: soc.towers }) : null],
    ['calendar', soc.year ? t('property.builtYear', { year: soc.year }) : null],
    ['users', soc.occupancy != null ? t('property.occupied', { occupancy: soc.occupancy }) : null],
  ].filter(([, val]) => val);

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="building-2" className="w-5 h-5 text-brand-teal-2" /> {t('property.societyInfoHeading')}</h2>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-teal-1/20 flex items-center justify-center flex-shrink-0"><Icon name="building" className="w-6 h-6 text-brand-teal-3" /></div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">{t('property.societyBuilding')}</p>
              <p className="font-bold text-white text-lg">{soc.name}</p>
              <div className="flex items-center gap-2 mt-1">
                {rating && rating.count ? (
                  <>
                    <Stars value={rating.avg} size={13} />
                    <span className="text-xs text-slate-500" data-testid="property-society-rating">{`${Number(rating.avg).toFixed(1)} · ${t('property.societyReviewCount', { count: rating.count })}`}</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">{[t('property.societyNotRated'), soc.builder].filter(Boolean).join(' · ')}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {quick.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
            {quick.map(([icon, val]) => (
              <div key={val} className="rd-cell flex items-center gap-2">
                <Icon name={icon} className="w-4 h-4 text-brand-teal-3 flex-shrink-0" />
                <span className="text-sm font-semibold text-white truncate">{val}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end mt-5">
          <Link to={`/society/${soc.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal-3 hover:underline flex-shrink-0">
            {t('property.viewSocietyProfile', { name: soc.name })} <Icon name="arrow-right" className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
