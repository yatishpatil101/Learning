/**
 * Board 1 of 3 — **host verification**. `GET/PATCH /admin/flatmate-reviews`.
 *
 * The question is *has this host proved what they claimed?* and the answer is a badge, not
 * visibility. A tenant-tier post says "I live here and I have a registered rent agreement", which
 * is self-declared; approving here is the only path by which such a post ever earns its Ops-verified
 * cue. **Rejecting does not hide the post** — `applyBadge` moves the badge and nothing else, because
 * failing verification means an unproven claim, not abuse. Abuse is the next board along.
 *
 * A rejection needs a reason. The server answers 400 without one and the database refuses it too,
 * so the rule holds whatever the write path; the check below only saves the round trip.
 */
import { useCallback, useState } from 'react';
import { BadgeCheck, Check, FileText, Flag, KeyRound, ShieldCheck, X } from 'lucide-react';
import { decideFlatmateReview, listFlatmateReviews } from '../../../services/flatmateService.js';
import { openDocUrl } from '../../../lib/openDoc.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { BoardCount, BoardState, InlineNote, PAGE_SIZE, Pager, Tabs, fmtDate, usePagedBoard } from './board.jsx';

/**
 * Every tab is a **server** query, not a filter over a window.
 *
 * `flagged` narrows to contested addresses — an address a different host has already claimed. It is
 * a reason to look rather than a verdict, so it sits inside the pending queue rather than beside it.
 */
const TABS = [
  { id: 'pending', label: 'Pending', params: { status: 'pending' } },
  { id: 'flagged', label: 'Contested address', params: { status: 'pending', flagged: true } },
  { id: 'approved', label: 'Ops-verified', params: { status: 'approved' } },
  { id: 'rejected', label: 'Rejected', params: { status: 'rejected' } },
  { id: 'all', label: 'All', params: {} },
];

export default function VerificationBoard() {
  const { toast } = useToast();
  const [tab, setTab] = useState('pending');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback((page) => {
    const params = TABS.find((t) => t.id === tab)?.params || {};
    return listFlatmateReviews({ ...params, page, size: PAGE_SIZE });
  }, [tab]);
  const board = usePagedBoard(load, tab);

  const decide = async (row, decision, note) => {
    try {
      await decideFlatmateReview(row.id, decision, note);
      toast(
        decision === 'approved'
          ? 'Approved — the host now shows Ops-verified'
          : 'Rejected — the host is told why',
        decision === 'approved' ? 'success' : 'error',
      );
      setRejecting(null);
      setReason('');
      board.reload();
    } catch (e) {
      // The server's own sentence. Its refusals name the field or the missing reason, and
      // paraphrasing them here would lose exactly the part the person needs.
      toast(e.message || 'That decision was refused.', 'error');
    }
  };

  const confirmReject = (row) => {
    const clean = reason.trim();
    if (!clean) { toast('Add a clear reason before rejecting', 'error'); return; }
    decide(row, 'rejected', clean);
  };

  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-teal/25 bg-brand-teal/5 p-4 text-sm text-gray-300">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" />
        <div>
          A tenant replacement listing is <b className="text-gray-200">Aadhaar-identity verified</b> already.
          Ops confirms the <b className="text-gray-200">registered rent agreement</b> (and, when present, that
          {' '}<b className="text-gray-200">owner consent</b> was captured) before it earns an
          {' '}<b className="text-gray-200">Ops-verified</b> badge. Rejecting withholds the badge —
          it does not take the post down. To hide a post, use <b className="text-gray-200">Moderation</b>.
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} label="Verification queues" />
      {board.status === 'ready' && (
        <BoardCount total={board.total} singular="host verification" plural="host verifications" />
      )}

      <BoardState state={board} onRetry={board.reload} empty="No host verifications here 🛏️" />

      {board.status === 'ready' && board.items.length ? (
        <>
        <div className="dz-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-semibold text-gray-400">
                <th className="p-3">Host</th>
                <th className="p-3">Flat / address</th>
                <th className="p-3">Claim</th>
                <th className="p-3">Signals</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {board.items.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="p-3">
                    <div className="font-semibold">{r.host || '—'}</div>
                    <div className="text-xs text-gray-400">{r.hostMobile || '—'}</div>
                    <div className="text-[11px] text-gray-500">{fmtDate(r.createdAt)}</div>
                  </td>
                  <td className="p-3 max-w-xs text-gray-300">
                    <div>{r.address || '—'}</div>
                    <span className="mt-1 inline-block rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                      {r.kind === 'room' ? 'Room' : 'Group'}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-1.5 py-0.5 text-[11px] capitalize text-brand-teal">
                      <KeyRound className="h-3 w-3" />{r.tier}-tier
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {r.agreementViewable ? (
                        <button type="button" onClick={() => openDocUrl(r.agreementDoc.dataUrl)} className="view-agreement-btn inline-flex items-center gap-1 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-1.5 py-0.5 text-[10px] text-brand-teal">
                          <FileText className="h-2.5 w-2.5" />View agreement
                        </button>
                      ) : r.agreementDoc ? (
                        // Over the 3 MB inline cap: the host has one, we cannot show it here.
                        <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                          <FileText className="h-2.5 w-2.5" />
                          {r.agreementTooLarge ? 'Agreement too large to preview' : 'Agreement on file'}
                        </span>
                      ) : r.tier === 'tenant' ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                          <X className="h-2.5 w-2.5" />No document
                        </span>
                      ) : null}
                      {r.ownerConsent && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          <Check className="h-2.5 w-2.5" />Owner consent
                        </span>
                      )}
                      {r.flagForReview && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                          <Flag className="h-2.5 w-2.5" />Contested address
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge status={r.status} />
                    {r.status === 'rejected' && r.reason ? (
                      <div className="mt-1 max-w-[12rem] text-[11px] text-rose-300">{r.reason}</div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    {r.status !== 'pending' ? (
                      <span className="text-xs text-gray-500">—</span>
                    ) : rejecting === r.id ? (
                      <InlineNote
                        value={reason}
                        onChange={setReason}
                        onConfirm={() => confirmReject(r)}
                        onCancel={() => { setRejecting(null); setReason(''); }}
                        placeholder="Reason for rejection"
                        confirmLabel="Confirm rejection"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => decide(r, 'approved')} className="approve-review-btn inline-flex items-center gap-1 rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">
                          <BadgeCheck className="h-3 w-3" />Approve
                        </button>
                        <button type="button" onClick={() => { setRejecting(r.id); setReason(''); }} className="reject-review-btn inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5">
                          <X className="h-3 w-3" />Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={board.page} size={PAGE_SIZE} total={board.total} onChange={board.setPage} />
        </>
      ) : null}
    </div>
  );
}
