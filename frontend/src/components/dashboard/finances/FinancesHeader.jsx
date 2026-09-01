import { useTranslation } from 'react-i18next';
import Icon from '../../Icon.jsx';
import Select from '../../ui/Select.jsx';
import Tip from '../../ui/Tip.jsx';

// Header: property + period + at-a-glance health + export, all in one row
export default function FinancesHeader({ finProp, setFinProp, listings, finPeriod, setFinPeriod, periodOpts, health, onExportCSV, onExportPDF }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-[10rem] max-w-[25rem]">
        <Select value={finProp} onChange={setFinProp} options={(listings || []).map((l) => ({ value: String(l.uuid || l.id), label: l.title }))} placeholder={t('fin.selectProperty')} className="w-full" />
      </div>
      <div className="w-40 shrink-0"><Select value={finPeriod} onChange={setFinPeriod} options={periodOpts} className="w-full" /></div>
      <Tip
        title={t('fin.healthTipTitle')}
        body={t('fin.healthTipBody')}
      >
        <button
          type="button"
          aria-label={t('fin.healthAria', { label: health.label })}
          className={'inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-xs font-semibold shrink-0 cursor-help transition-colors ' + health.cls}
        >
          <span className={'w-2 h-2 rounded-full ' + health.dot} aria-hidden="true" /> {health.label}
          <Icon name="info" className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
        </button>
      </Tip>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onExportCSV} aria-label={t('fin.exportCsv')} title={t('fin.exportCsv')} className="dz-control dz-control--ghost gap-1.5">
          <Icon name="table" className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold">CSV</span>
        </button>
        <button type="button" onClick={onExportPDF} aria-label={t('fin.exportPdf')} title={t('fin.exportPdf')} className="dz-control dz-control--ghost gap-1.5">
          <Icon name="file-text" className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold">PDF</span>
        </button>
      </div>
    </div>
  );
}
