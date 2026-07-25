import { Link } from 'react-router';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export default function SmartAlertsPanel({ alerts, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="mb-6 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-bold text-gray-200">Smart alerts</h2>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">{alerts.length}</span>
      </div>
      {alerts.slice(0, 5).map((alert) => {
        const sev = {
          critical: { bg: 'border-rose-500/30 bg-rose-500/5', icon: AlertTriangle, iconColor: 'text-rose-400' },
          warning: { bg: 'border-amber-500/30 bg-amber-500/5', icon: AlertTriangle, iconColor: 'text-amber-400' },
          info: { bg: 'border-sky-500/30 bg-sky-500/5', icon: Info, iconColor: 'text-sky-400' },
        }[alert.severity];
        const SevIcon = sev.icon;
        return (
          <div key={alert.id} className={`flex items-start gap-3 rounded-xl border p-3.5 ${sev.bg}`}>
            <SevIcon className={`h-4 w-4 mt-0.5 shrink-0 ${sev.iconColor}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-100">{alert.title}</div>
              <div className="text-xs text-gray-400 mt-0.5">{alert.body}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to={alert.href} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors">View</Link>
              <button onClick={() => onDismiss(alert.id)} className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 hover:bg-white/10 hover:text-gray-300 transition-colors" title="Dismiss"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        );
      })}
      {alerts.length > 5 && <div className="text-xs text-gray-500 pl-7">+ {alerts.length - 5} more alerts</div>}
    </div>
  );
}
