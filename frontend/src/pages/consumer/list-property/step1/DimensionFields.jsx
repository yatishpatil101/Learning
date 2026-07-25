import { useTranslation } from 'react-i18next';
import Select from '../../../../components/ui/Select';
import { Pill, FieldError } from '../controls.jsx';
import { fld, lbl3 } from '../styles.js';
import { facingOptions, ageOptions, floorOptions, totalFloorsOptions, plotUnitOptions, farmUnitOptions } from '../constants.js';

const DimensionFields = ({ form, set, errors, isLand, isHouse, isCommercial }) => {
  const { t: tr } = useTranslation();
  const isFarm = form.propertyType === 'farmland';
  const areaLabel = isLand() ? (isFarm ? tr('listProperty.fields.landArea') : tr('listProperty.fields.plotAreaLabel')) : tr('listProperty.fields.carpetArea');
  const unitOptions = isFarm ? farmUnitOptions : plotUnitOptions;
  return (
    <>
      {/* Area */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl3}>{areaLabel} *</label>
          <div className="relative">
            <input type="number" value={form.carpetArea} onChange={(e) => set('carpetArea', e.target.value)} data-err="carpetArea"
              placeholder={tr('listProperty.ph.eg1050')} className={`${fld} pr-20 ${errors.carpetArea ? 'pn-invalid' : ''}`} />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">
              {isLand() ? (unitOptions.find(([v]) => v === form.areaUnit)?.[1] || unitOptions[0][1]) : 'sq.ft.'}
            </div>
          </div>
          <FieldError show={!!errors.carpetArea}>{tr('listProperty.err.enterArea', { label: areaLabel.toLowerCase() })}</FieldError>
        </div>
        {isLand() ? (
          <div>
            <label className={lbl3}>{tr('listProperty.fields.areaUnit')}</label>
            <Select value={form.areaUnit} onChange={(v) => set('areaUnit', v)} placeholder={tr('listProperty.ph.selectUnit')}
              options={unitOptions.map(([value, label]) => ({ value, label }))} />
          </div>
        ) : (
          <div>
            <label className={lbl3}>{tr('listProperty.fields.builtUpArea')}</label>
            <div className="relative">
              <input type="number" value={form.builtUp} onChange={(e) => set('builtUp', e.target.value)}
                placeholder={tr('listProperty.ph.eg1200')} className={`${fld} pr-20`} />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
            </div>
          </div>
        )}
      </div>

      {/* Plot area + storeys — houses sit on land they own, so they carry
         both a carpet area and a plot area, and floor count instead of floor no. */}
      {isHouse() && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl3}>{tr('listProperty.fields.plotArea')}</label>
            <div className="relative">
              <input type="number" value={form.plotArea} onChange={(e) => set('plotArea', e.target.value)}
                placeholder={tr('listProperty.ph.eg2400')} className={`${fld} pr-20`} />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
            </div>
          </div>
          <div>
            <label className={lbl3}>{tr('listProperty.fields.floorsInHouse')}</label>
            <div className="flex flex-wrap gap-2.5">
              {[['1', tr('listProperty.opt.ground')], ['2', 'G+1'], ['3', 'G+2'], ['4', 'G+3+']].map(([v, l]) => (
                <Pill key={v} selected={form.floorsInHouse === v} onClick={() => set('floorsInHouse', v)} className="px-5 py-2.5">{l}</Pill>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floor — only built-in-a-tower types (flats, commercial units). */}
      {(form.propertyType === 'flat' || isCommercial()) && (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className={lbl3}>{tr('listProperty.fields.floorNo')}</label>
            <Select value={form.floor} onChange={(v) => set('floor', v)} placeholder={tr('listProperty.ph.select')} searchable options={floorOptions} />
          </div>
          <div>
            <label className={lbl3}>{tr('listProperty.fields.totalFloors')}</label>
            <Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} placeholder={tr('listProperty.ph.select')} searchable options={totalFloorsOptions} />
          </div>
        </div>
      )}

      {/* Facing & Age — relevant for every built type, not for raw land. */}
      {!isLand() && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl3}>{tr('listProperty.fields.facing')}</label>
            <Select value={form.facing} onChange={(v) => set('facing', v)} placeholder={tr('listProperty.ph.selectFacing')} options={facingOptions} />
          </div>
          <div>
            <label className={lbl3}>{tr('listProperty.fields.ageOfProperty')}</label>
            <Select value={form.age} onChange={(v) => set('age', v)} placeholder={tr('listProperty.ph.selectAge')} options={ageOptions} />
          </div>
        </div>
      )}
    </>
  );
};

export default DimensionFields;
