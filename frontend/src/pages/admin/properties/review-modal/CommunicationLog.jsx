import { History } from 'lucide-react';
import { fmtAgo } from '../constants.js';

/** `entry.by` is optional, so the separator is rendered with it instead of leaving stray punctuation. */
export default function CommunicationLog({ commsOpen, setCommsOpen, commsLog }) {
  return (
    <div className="px-4 py-3">
      <button type="button" aria-expanded={commsOpen} onClick={() => setCommsOpen(!commsOpen)} className="flex w-full items-center justify-between text-sm font-semibold text-gray-200">
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-400" /> Communication log
          <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">{commsLog.length}</span>
        </span>
        <span className="text-xs font-medium text-teal-300">{commsOpen ? 'Hide' : 'Show timeline'}</span>
      </button>
      {commsOpen && (
        <div className="mt-3 max-h-80 overflow-y-auto">
          {commsLog.length > 0 ? (
            <div className="relative pl-5 border-l border-white/10">
              {commsLog.map((entry) => {
                const typeStyle = { status: { dot: 'bg-emerald-400', label: 'text-emerald-300' }, outreach: { dot: 'bg-teal-400', label: 'text-teal-300' }, 'owner-action': { dot: 'bg-amber-400', label: 'text-amber-300' }, note: { dot: 'bg-indigo-400', label: 'text-indigo-300' } }[entry.type] || { dot: 'bg-gray-400', label: 'text-gray-300' };
                return (
                  <div key={entry.id} data-testid="comms-entry" className="relative mb-4 last:mb-0">
                    <div className={`absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink ${typeStyle.dot}`} />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className={`text-xs font-semibold ${typeStyle.label}`}>{entry.action}</span>
                        <p data-testid="comms-entry-detail" className="text-sm text-gray-300 mt-0.5">{entry.detail}</p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                          {entry.by ? <><span>{entry.by}</span><span>{'\u00B7'}</span></> : null}
                          <span>{fmtAgo(entry.at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-gray-500">No communication history yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
