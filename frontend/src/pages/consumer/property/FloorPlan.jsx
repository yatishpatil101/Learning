import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { fmtNum } from '../../../lib/format.js';
import { floorPlanFor, propertyKind } from './derivations.js';

const FLOOR_PLAN_IMG = 'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=900&q=80';

export function FloorPlan({ p }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  const planImg = p.floorPlan || floorPlanFor(p) || FLOOR_PLAN_IMG;
  const isResidential = propertyKind(p) === 'residential';
  const superA = p.area || 0;
  const built = Math.round(superA * 0.84);
  const carpet = Math.round(superA * 0.70);
  /* The owner's answer, or nothing (D244). Derived from `bhk - 1` until V114 gave it a column,
     which put a number the owner never gave into a spec row beside the carpet area. */
  const balconies = p.balconies ?? null;
  useEffect(() => {
    if (!zoom) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [zoom]);
  const row = (lbl, val, border = true, tipKey = null) => {
    const inner = (
      <div className={'flex items-center justify-between py-2 ' + (border ? 'border-b border-white/6' : '')}>
        <span className="text-sm text-slate-300">{lbl}</span>
        <span className="text-sm font-bold text-white">{val}</span>
      </div>
    );
    return tipKey ? <Tip k={tipKey}>{inner}</Tip> : inner;
  };
  return (
    <section className="fade-in section-mb">
      {/* Collapsed on phones (D141). A ~380px plan image plus a five-row area table is
         ~640px of the page, and it answers "how is the space laid out" — a question a
         buyer asks *after* deciding the size, price and location are plausible. The
         carpet area is the single number most people came to this block for, so it is
         the summary and stays readable while the block is shut. Desktop is unchanged. */}
      <MobileCollapse
        headerClassName="mb-6"
        label={t('property.floorPlan')}
        summary={fmtNum(carpet) + ' sq.ft.'}
        header={<h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="maximize" className="w-5 h-5 text-brand-teal-2" /> {t('property.floorPlan')}</h2>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="main-image-wrapper rounded-2xl overflow-hidden bg-white/[0.03] border border-white/8">
              <img src={planImg} alt={t('property.floorPlanAlt')} loading="lazy" onClick={() => setZoom(true)} className="w-full h-72 sm:h-96 object-contain bg-[#f8fafc] cursor-zoom-in" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="glass rounded-2xl p-6 h-full">
              <h3 className="font-semibold text-white mb-4">{t('property.areaBreakdown')}</h3>
              <div className="space-y-3">
                {row(t('property.superBuiltup'), fmtNum(superA) + ' sq.ft.', true, 'floorplan.superBuiltup')}
                {row(t('property.builtupArea'), fmtNum(built) + ' sq.ft.', true, 'floorplan.builtup')}
                {row(t('property.carpetArea'), fmtNum(carpet) + ' sq.ft.', isResidential, 'floorplan.carpet')}
                {isResidential && balconies != null ? row(t('property.balconies'), balconies, false, 'floorplan.balconies') : null}
              </div>
              <div className="mt-5 px-4 py-3 rounded-xl bg-brand-teal-1/10 border border-brand-teal-2/20 text-xs text-brand-teal-3 flex items-start gap-2">
                <Icon name="info" className="w-4 h-4 flex-shrink-0 mt-0.5" /> {t('property.carpetEfficient')}
              </div>
            </div>
          </div>
        </div>
      </MobileCollapse>
      {zoom ? (
        <div className="pn-lightbox" role="dialog" aria-modal="true" aria-label={t('property.floorPlanAlt')} onClick={(e) => { if (e.target === e.currentTarget) setZoom(false); }}>
          <button className="pn-lb-close" onClick={() => setZoom(false)} aria-label={t('property.close')}><Icon name="x" className="w-6 h-6" /></button>
          <div className="pn-lb-stage">
            <img src={planImg} alt={t('property.floorPlanAlt')} />
            <p className="pn-lb-caption">{t('property.floorPlanAlt')}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
