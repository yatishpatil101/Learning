import Icon from '../../Icon.jsx';
import Select from '../../ui/Select.jsx';
import Tip from '../../ui/Tip.jsx';

// Header: property + period + at-a-glance health + export, all in one row
export default function FinancesHeader({ finProp, setFinProp, listings, finPeriod, setFinPeriod, periodOpts, health, onExportCSV, onExportPDF }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-[10rem] max-w-[25rem]">
        <Select value={finProp} onChange={setFinProp} options={(listings || []).map((l) => ({ value: l.id, label: l.title }))} placeholder="Select property" className="w-full" />
      </div>
      <div className="w-40 shrink-0"><Select value={finPeriod} onChange={setFinPeriod} options={periodOpts} className="w-full" /></div>
      <Tip
        title="How this is calculated"
        body="A single money-at-risk signal for the selected property and period. Red — a payment is overdue. Amber — a payment is due soon or cashflow is negative. Green (Healthy) — nothing is due and cashflow is positive."
      >
        <button
          type="button"
          aria-label={`Financial health: ${health.label}. How this is calculated.`}
          className={'inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-xs font-semibold shrink-0 cursor-help transition-colors ' + health.cls}
        >
          <span className={'w-2 h-2 rounded-full ' + health.dot} aria-hidden="true" /> {health.label}
          <Icon name="info" className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
        </button>
      </Tip>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onExportCSV} aria-label="Export as CSV" title="Export as CSV" className="pn-control pn-control--ghost gap-1.5">
          <Icon name="table" className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold">CSV</span>
        </button>
        <button type="button" onClick={onExportPDF} aria-label="Export as PDF" title="Export as PDF" className="pn-control pn-control--ghost gap-1.5">
          <Icon name="file-text" className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold">PDF</span>
        </button>
      </div>
    </div>
  );
}
