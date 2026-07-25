import Icon from '../../Icon.jsx';
import { fmtINR } from '../../../lib/format.js';
import { Card, SectionHead } from './helpers.jsx';

// Action required — money-at-risk stays visible above the tabs
export default function DuesSection({ dues, onRemind }) {
  if (!(dues.overdue.length > 0 || dues.upcoming.length > 0)) return null;
  return (
    <Card className="p-5 sm:p-6">
      <SectionHead icon="alert-triangle" iconCls="text-amber-400" title="Action required" sub="Overdue & upcoming dues" />
      <div className="space-y-2">
        {dues.overdue.map((d, i) => (
          <div key={'od' + i} className="flex items-center gap-3 p-3 rounded-lg bg-rose-500/10">
            <Icon name="alert-circle" className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-rose-100 truncate">{d.category}{d.note ? ` — ${d.note}` : ''}</p>
              <p className="text-[11px] text-rose-300/80">{Math.abs(d.daysUntil)} {Math.abs(d.daysUntil) === 1 ? 'day' : 'days'} overdue · was due {d.nextDue}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-sm font-semibold text-rose-300">{fmtINR(d.amount)}</span>
              <button onClick={() => onRemind(d)} className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-200 hover:text-white py-1"><Icon name="bell" className="w-3.5 h-3.5" /> Remind</button>
            </div>
          </div>
        ))}
        {dues.upcoming.map((d, i) => (
          <div key={'up' + i} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10">
            <Icon name="clock" className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-amber-100 truncate">{d.category}{d.note ? ` — ${d.note}` : ''}</p>
              <p className="text-[11px] text-amber-300/80">due in {d.daysUntil} {d.daysUntil === 1 ? 'day' : 'days'} · {d.nextDue}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-sm font-semibold text-amber-200">{fmtINR(d.amount)}</span>
              <button onClick={() => onRemind(d)} className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-200 hover:text-white py-1"><Icon name="bell" className="w-3.5 h-3.5" /> Remind</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
