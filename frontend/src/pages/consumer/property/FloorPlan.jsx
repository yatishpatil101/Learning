import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { fmtNum } from '../../../lib/format.js';
import { propertyKind } from './derivations.js';

export function FloorPlan({ p }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  /* The photo the owner tagged "Floor Plan", or nothing: under this heading a schematic picked from type
     and BHK reads as a drawing of *this* flat, and only the owner can tell the two apart. */
  const planImg = p.floorPlan || null;
  const isResidential = propertyKind(p) === 'residential';
  /* Only areas the owner stated. A loading factor applied to `area` would render an invented number in the
     same weight as the price, on the one figure RERA makes a builder answerable for. */
  const superA = p.superBuiltUpArea ?? null;
  const built = p.builtUpArea ?? null;
  const carpet = p.carpetArea ?? null;
  /* The owner's answer, or nothing: deriving it from `bhk - 1` puts a number they never gave into a spec
     row beside the carpet area. */
  const balconies = p.balconies ?? null;
  const areaRows = [
    { k: 'super', lbl: t('property.superBuiltup'), val: superA, tipKey: 'floorplan.superBuiltup' },
    { k: 'built', lbl: t('property.builtupArea'), val: built, tipKey: 'floorplan.builtup' },
    { k: 'carpet', lbl: t('property.carpetArea'), val: carpet, tipKey: 'floorplan.carpet' },
  /* Rounded, because these are `BigDecimal` columns and the wizard accepts fractions — every other
     area on the site is a whole number, and "1,050.5 sq.ft." reads as a precision nobody measured. */
  ].filter((r) => r.val != null).map((r) => ({ ...r, val: fmtNum(Math.round(r.val)) + ' sq.ft.' }));
  /* No breakdown on record, so show the one figure there is under a label that does not claim which of the
     three it is: `submit.js` sets `area` from `carpetArea || builtUp` without recording the branch. */
  if (!areaRows.length && p.area) {
    areaRows.push({ k: 'total', lbl: t('property.totalArea'), val: fmtNum(Math.round(p.area)) + ' sq.ft.', tipKey: 'floorplan.total' });
  }
  /* Read before balconies joins the list, so a listing with a balcony count and no area at all
     cannot summarise a shut block with a bare "2". */
  const areaSummary = areaRows[0]?.val || '';
  if (isResidential && balconies != null) {
    areaRows.push({ k: 'balconies', lbl: t('property.balconies'), val: String(balconies), tipKey: 'floorplan.balconies' });
  }
  useEffect(() => {
    if (!zoom) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [zoom]);
  const row = (k, lbl, val, border = true, tipKey) => (
    <Tip key={k} k={tipKey}>
      <div className={'flex items-center justify-between py-2 ' + (border ? 'border-b border-white/6' : '')}>
        <span className="text-sm text-slate-300">{lbl}</span>
        <span className="text-sm font-bold text-white">{val}</span>
      </div>
    </Tip>
  );
  return (
    <section className="fade-in section-mb">
      {/* Collapsed on phones (D141). A ~380px plan image plus a five-row area table is
         ~640px of the page, and it answers "how is the space laid out" — a question a
         buyer asks *after* deciding the size, price and location are plausible. The
         summary is the table's own first row, so a shut block cannot quote a figure the
         open one contradicts — an unlabelled number on a collapsed block reads as "the
         size", and finding a different one on opening undermines the whole point of
         this change. */}
      <MobileCollapse
        headerClassName="mb-6"
        label={t('property.floorPlan')}
        summary={areaSummary}
        header={<h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="maximize" className="w-5 h-5 text-brand-teal-2" /> {t('property.floorPlan')}</h2>}
      >
        {planImg ? null : (
          <p className="text-sm text-slate-400 mb-4">{t('property.floorPlanNotShared')}</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {planImg ? (
            <div className="lg:col-span-3">
              <div className="main-image-wrapper rounded-2xl overflow-hidden bg-white/[0.03] border border-white/8">
                <img src={planImg} alt={t('property.floorPlanAlt')} loading="lazy" onClick={() => setZoom(true)} className="w-full h-72 sm:h-96 object-contain bg-[#f8fafc] cursor-zoom-in" />
              </div>
            </div>
          ) : null}
          <div className={planImg ? 'lg:col-span-2' : 'lg:col-span-5'}>
            <div className="glass rounded-2xl p-6 h-full">
              <h3 className="font-semibold text-white mb-4">{t('property.areaBreakdown')}</h3>
              <div className="space-y-3">
                {areaRows.map((r, i) => row(r.k, r.lbl, r.val, i < areaRows.length - 1, r.tipKey))}
                {superA == null && built == null && carpet == null
                  ? <p className="text-sm text-slate-400">{t('property.areaNotStated')}</p>
                  : null}
              </div>
              {/* Only when both ends of the ratio are stated, and stating the listing's own ratio.
                  This note used to read "Carpet area is 70% of super built-up" unconditionally,
                  which was true of every listing for the same reason the numbers above it were:
                  0.70 was the constant that produced them. */}
              {carpet != null && superA ? (
                <div className="mt-5 px-4 py-3 rounded-xl bg-brand-teal-1/10 border border-brand-teal-2/20 text-xs text-brand-teal-3 flex items-start gap-2">
                  <Icon name="info" className="w-4 h-4 flex-shrink-0 mt-0.5" /> {t('property.carpetEfficient', { pct: Math.round((carpet / superA) * 100) })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </MobileCollapse>
      {zoom ? (
        <div className="dz-lightbox" role="dialog" aria-modal="true" aria-label={t('property.floorPlanAlt')} onClick={(e) => { if (e.target === e.currentTarget) setZoom(false); }}>
          <button className="dz-lb-close" onClick={() => setZoom(false)} aria-label={t('property.close')}><Icon name="x" className="w-6 h-6" /></button>
          <div className="dz-lb-stage">
            <img src={planImg} alt={t('property.floorPlanAlt')} />
            <p className="dz-lb-caption">{t('property.floorPlanAlt')}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
