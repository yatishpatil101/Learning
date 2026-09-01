import { Flag, MessageCircle, MapPin } from 'lucide-react';
// A pure regex validator, not state — it stays a local import after the migration because there is
// no endpoint to ask "is this a real WhatsApp invite", and there should not be: the operator is
// looking at the link precisely because a server cannot tell a scam group from a real one.
import { isSafeWhatsappUrl } from '../../../lib/store.js';
import { titleCase, fmtDate, Chip, actBtn, REPORT_LABELS, TEAL, RED, PLAIN } from './helpers.jsx';

/**
 * The three queues that are one queue.
 *
 * Group links and pin corrections are `kind` filters on `/admin/society-proposals`, so both panels
 * below read identical row shapes — `id`, `societySlug`, `authorName`, `createdAt` — and differ only
 * in which optional columns are populated. Reports come from the platform-wide report queue,
 * narrowed to society kinds by the page above.
 */
export default function ModerationTab({ reports, waPending, locFixes, decideReport, decideWa, decideLoc, deciding }) {
  // A decision is a round trip. Without this the buttons stay live and look ignored, so the
  // operator clicks again — the write is already guarded, but the silence is what invites it.
  const busy = (id) => Boolean(deciding && deciding.has(id));
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
                  <Chip tone="bg-white/10 text-gray-200">{REPORT_LABELS[r.kind] || r.kind}</Chip>
                  <span className="text-xs text-gray-500">{fmtDate(r.at)}</span>
                </div>
                {/* No snapshot of the offending text, and no society link. The report carries a
                    target id, not a copy of the content and not the page it sits on — a snapshot
                    would go stale the moment the author edited, and the queue would show the
                    operator words nobody can still see. `targetTitle` degrades to the bare id. */}
                <p className="text-sm text-gray-200 line-clamp-3 break-words">{r.targetTitle || r.targetId || '—'}</p>
                <div className="mt-1.5 text-xs text-gray-400">Reason: <span className="text-gray-300">{r.reasonLabel || r.reason || 'Not specified'}</span></div>
                {r.details ? <div className="mt-0.5 text-xs text-gray-500 line-clamp-2 break-words">{r.details}</div> : null}
                {/* The reporter is withheld by design — a moderator who can see who flagged them is
                    a moderator who can be leaned on. */}
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Remove content', RED, () => decideReport(r, 'remove'), busy(r.id))}
                  {actBtn('Dismiss', PLAIN, () => decideReport(r, 'dismiss'), busy(r.id))}
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
              // Keyed by the proposal id, not by the slug: one society can have two links queued.
              <li key={w.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <a href={`/society/${w.societySlug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-teal hover:underline">{titleCase(w.societySlug)}</a>
                  <span className="text-xs text-gray-500">{fmtDate(w.createdAt)}</span>
                </div>
                {isSafeWhatsappUrl(w.inviteUrl)
                  ? <a href={w.inviteUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-emerald-300 hover:underline">{w.inviteUrl}</a>
                  : <div className="block truncate text-xs text-red-300">⚠ Invalid link — reject: {w.inviteUrl}</div>}
                <div className="mt-0.5 text-xs text-gray-500">Proposed by {w.authorName || 'Resident'}</div>
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Approve', TEAL, () => decideWa(w, 'approve'), busy(w.id))}
                  {actBtn('Reject', RED, () => decideWa(w, 'reject'), busy(w.id))}
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
              <li key={l.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <a href={`/society/${l.societySlug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-teal hover:underline">{titleCase(l.societySlug)}</a>
                  <span className="text-xs text-gray-500">{fmtDate(l.createdAt)}</span>
                </div>
                {l.label ? <div className="text-xs text-gray-300 line-clamp-1 break-words">{l.label}</div> : null}
                <div className="mt-0.5 text-xs text-gray-500">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${Number(l.lat)},${Number(l.lng)}`} target="_blank" rel="noopener noreferrer" className="text-brand-teal hover:underline">{Number(l.lat).toFixed(5)}, {Number(l.lng).toFixed(5)}</a>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">Proposed by {l.authorName || 'Resident'}</div>
                <div className="mt-2.5 flex gap-2">
                  {actBtn('Approve', TEAL, () => decideLoc(l, 'approve'), busy(l.id))}
                  {actBtn('Reject', RED, () => decideLoc(l, 'reject'), busy(l.id))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
