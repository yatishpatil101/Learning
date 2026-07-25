import { Flag, MessageCircle, MapPin } from 'lucide-react';
import { isSafeWhatsappUrl } from '../../../lib/store.js';
import { titleCase, fmtDate, Chip, actBtn, REPORT_LABELS, TEAL, RED, PLAIN } from './helpers.jsx';

export default function ModerationTab({ reports, waPending, locFixes, decideReport, decideWa, decideLoc }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="pn-card p-4">
        <div className="mb-3 flex items-center gap-2"><Flag className="h-4 w-4 text-red-300" /><h3 className="font-bold">Reported content <span className="text-gray-400 font-normal">({reports.length})</span></h3></div>
        {reports.length === 0 ? (
          <p className="text-sm text-gray-400">No open reports. Resident flags on society posts land here.</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Chip tone="bg-white/10 text-gray-200">{REPORT_LABELS[r.targetType] || r.targetType}</Chip>
                  <span className="text-xs text-gray-500">{fmtDate(r.at)}</span>
                </div>
                <p className="text-sm text-gray-200 line-clamp-3 break-words">“{r.snapshot || '—'}”</p>
                <div className="mt-1.5 text-xs text-gray-400">Reason: <span className="text-gray-300">{r.reason || 'Not specified'}</span></div>
                <div className="mt-0.5 text-xs text-gray-500">Reported by {r.by || 'Member'} · <a href={`/society/${r.slug}`} target="_blank" rel="noopener noreferrer" className="text-brand-teal hover:underline">{titleCase(r.slug)}</a></div>
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Remove content', RED, () => decideReport(r, 'remove'))}
                  {actBtn('Dismiss', PLAIN, () => decideReport(r, 'dismiss'))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pn-card p-4">
        <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-300" /><h3 className="font-bold">Pending WhatsApp links <span className="text-gray-400 font-normal">({waPending.length})</span></h3></div>
        {waPending.length === 0 ? (
          <p className="text-sm text-gray-400">No links awaiting review. Residents propose group links from the society hub.</p>
        ) : (
          <ul className="space-y-3">
            {waPending.map((w) => (
              <li key={w.slug} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <a href={`/society/${w.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-teal hover:underline">{titleCase(w.slug)}</a>
                  <span className="text-xs text-gray-500">{fmtDate(w.at)}</span>
                </div>
                {isSafeWhatsappUrl(w.url)
                  ? <a href={w.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-emerald-300 hover:underline">{w.url}</a>
                  : <div className="block truncate text-xs text-red-300">⚠ Invalid link — reject: {w.url}</div>}
                <div className="mt-0.5 text-xs text-gray-500">Proposed by {w.by || 'Resident'}</div>
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Approve', TEAL, () => decideWa(w, 'approve'))}
                  {actBtn('Reject', RED, () => decideWa(w, 'reject'))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pn-card p-4">
        <div className="mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-teal-300" /><h3 className="font-bold">Location fixes <span className="text-gray-400 font-normal">({locFixes.length})</span></h3></div>
        {locFixes.length === 0 ? (
          <p className="text-sm text-gray-400">No proposed pins. Verified residents suggest corrected society locations from the hub.</p>
        ) : (
          <ul className="space-y-3">
            {locFixes.map((l) => (
              <li key={l.slug} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <a href={`/society/${l.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-teal hover:underline">{titleCase(l.slug)}</a>
                  <span className="text-xs text-gray-500">{fmtDate(l.at)}</span>
                </div>
                {l.label ? <div className="text-xs text-gray-300 line-clamp-1 break-words">{l.label}</div> : null}
                <div className="mt-0.5 text-xs text-gray-500">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${Number(l.lat)},${Number(l.lng)}`} target="_blank" rel="noopener noreferrer" className="text-brand-teal hover:underline">{Number(l.lat).toFixed(5)}, {Number(l.lng).toFixed(5)}</a>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">Proposed by {l.by || 'Resident'}</div>
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Approve', TEAL, () => decideLoc(l, 'approve'))}
                  {actBtn('Reject', RED, () => decideLoc(l, 'reject'))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
