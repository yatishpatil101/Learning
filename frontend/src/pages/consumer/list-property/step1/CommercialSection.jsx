import { useTranslation } from 'react-i18next';
import MultiSelect from '../../../../components/ui/MultiSelect';
import { Pill, ToggleRow } from '../controls.jsx';
import { fld, lbl, lbl3 } from '../styles.js';
import { shellOptions, washroomOptions, suitableForTags } from '../constants.js';

const CommercialSection = ({ form, set, isCommercial }) => {
  const { t: tr } = useTranslation();
  if (!isCommercial()) return null;
  return (
    /* ===== Commercial specifics ===== */
    <>
      <div className="mb-6">
        <label className={lbl3}>{tr('listProperty.fields.fitOutStatus')}</label>
        <div className="flex flex-wrap gap-3">
          {shellOptions.map(([v, l]) => (
            <Pill key={v} selected={form.shellType === v} onClick={() => set('shellType', v)} className="px-6 py-3">{l}</Pill>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={lbl3}>{tr('listProperty.fields.washrooms')}</label>
          <div className="flex flex-wrap gap-2.5">
            {washroomOptions.map((n) => (
              <Pill key={n} selected={form.washrooms === n} onClick={() => set('washrooms', n)} className="px-5 py-2.5">{n}</Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl3}>{tr('listProperty.fields.parkingSpaces')}</label>
          <input type="number" value={form.parkingSpaces} onChange={(e) => set('parkingSpaces', e.target.value)}
            placeholder={tr('listProperty.ph.eg4')} className={fld} />
        </div>
      </div>

      {/* Maintenance / CAM and Suitable For share one row so
         neither stretches the full width or leaves the other
         half empty — CAM stays a compact half-width input. */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={`${lbl} mb-1`}>{tr('listProperty.fields.maintenanceCam')}</label>
          <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.camPerSqft')}</p>
          <input type="number" value={form.camCharges} onChange={(e) => set('camCharges', e.target.value)}
            placeholder={tr('listProperty.ph.eg12')} className={fld} />
        </div>
        <div>
          <label className={`${lbl} mb-1`}>{tr('listProperty.fields.suitableFor')}</label>
          <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.suitableForHelp')}</p>
          <MultiSelect
            values={form.suitableFor || []}
            onChange={(v) => set('suitableFor', v)}
            placeholder={tr('listProperty.ph.selectSuitable')}
            ariaLabel={tr('listProperty.aria.suitableFor')}
            options={suitableForTags}
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleRow title={tr('listProperty.toggle.powerBackup')} subtitle={tr('listProperty.toggle.powerBackupSub')} on={form.powerBackup} onClick={() => set('powerBackup', !form.powerBackup)} />
        <ToggleRow title={tr('listProperty.toggle.pantry')} subtitle={tr('listProperty.toggle.pantrySub')} on={form.pantry} onClick={() => set('pantry', !form.pantry)} />
      </div>
    </>
  );
};

export default CommercialSection;
