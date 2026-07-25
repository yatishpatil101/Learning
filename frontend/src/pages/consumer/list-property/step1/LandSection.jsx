import { useTranslation } from 'react-i18next';
import Select from '../../../../components/ui/Select';
import { Pill, ToggleRow } from '../controls.jsx';
import { fld, lbl3, ddSolo } from '../styles.js';
import { openSidesOptions, plotZoneOptions, waterSourceOptions } from '../constants.js';

const LandSection = ({ form, set, isLand }) => {
  const { t: tr } = useTranslation();
  if (!isLand()) return null;
  const isFarm = form.propertyType === 'farmland';
  return (
    /* ===== Land specifics (Open Plot / Farm Land) ===== */
    <>
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div>
          <label className={lbl3}>{tr('listProperty.fields.plotLength')}</label>
          <div className="relative">
            <input type="number" value={form.plotLength} onChange={(e) => set('plotLength', e.target.value)}
              placeholder={tr('listProperty.ph.eg60')} className={`${fld} pr-14`} />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
          </div>
        </div>
        <div>
          <label className={lbl3}>{tr('listProperty.fields.plotWidth')}</label>
          <div className="relative">
            <input type="number" value={form.plotWidth} onChange={(e) => set('plotWidth', e.target.value)}
              placeholder={tr('listProperty.ph.eg40')} className={`${fld} pr-14`} />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={lbl3}>{tr('listProperty.fields.approachRoadWidth')}</label>
          <div className="relative">
            <input type="number" value={form.roadWidth} onChange={(e) => set('roadWidth', e.target.value)}
              placeholder={tr('listProperty.ph.eg30')} className={`${fld} pr-14`} />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
          </div>
        </div>
        {!isFarm && (
          <div>
            <label className={lbl3}>{tr('listProperty.fields.openSides')}</label>
            <div className="flex flex-wrap gap-2.5">
              {openSidesOptions.map((n) => (
                <Pill key={n} selected={form.openSides === n} onClick={() => set('openSides', n)} className="px-5 py-2.5">{n}</Pill>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isFarm && (
        <div className="mb-6">
          <label className={lbl3}>{tr('listProperty.fields.zoning')}</label>
          <Select className={ddSolo} value={form.plotZone} onChange={(v) => set('plotZone', v)} placeholder={tr('listProperty.ph.selectZone')} options={plotZoneOptions} />
        </div>
      )}

      {isFarm && (
        <div className="mb-6">
          <label className={lbl3}>{tr('listProperty.fields.waterSource')}</label>
          <Select className={ddSolo} value={form.waterSource} onChange={(v) => set('waterSource', v)} placeholder={tr('listProperty.ph.selectWaterSource')} options={waterSourceOptions} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleRow title={tr('listProperty.toggle.cornerPlot')} subtitle={tr('listProperty.toggle.cornerPlotSub')} on={form.cornerPlot} onClick={() => set('cornerPlot', !form.cornerPlot)} />
        <ToggleRow title={tr('listProperty.toggle.boundaryWall')} subtitle={tr('listProperty.toggle.boundaryWallSub')} on={form.boundaryWall} onClick={() => set('boundaryWall', !form.boundaryWall)} />
        {!isFarm && (
          <ToggleRow title={tr('listProperty.toggle.naSanctioned')} subtitle={tr('listProperty.toggle.naSanctionedSub')} on={form.naSanctioned} onClick={() => set('naSanctioned', !form.naSanctioned)} />
        )}
        {isFarm && (
          <>
            <ToggleRow title={tr('listProperty.toggle.electricity')} subtitle={tr('listProperty.toggle.electricitySub')} on={form.electricity} onClick={() => set('electricity', !form.electricity)} />
            <ToggleRow title={tr('listProperty.toggle.roadAccess')} subtitle={tr('listProperty.toggle.roadAccessSub')} on={form.roadAccess} onClick={() => set('roadAccess', !form.roadAccess)} />
            <ToggleRow title={tr('listProperty.toggle.satbara')} subtitle={tr('listProperty.toggle.satbaraSub')} on={form.satbara} onClick={() => set('satbara', !form.satbara)} />
          </>
        )}
      </div>
    </>
  );
};

export default LandSection;
