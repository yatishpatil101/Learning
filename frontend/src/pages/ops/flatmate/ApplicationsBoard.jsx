/**
 * Board 3 of 3 — **group applications**. `GET/PATCH /admin/group-applications`.
 *
 * A formed group applying to take a whole listing. Two statuses ride on every row and only one of
 * them is ours:
 *
 *   `status`    — the **owner's** accept/decline. Read-only here, and the server could not let us
 *                 write it if we tried: `FlatmateGroupApplication#moderate` cannot reach the field.
 *   `modStatus` — **our** axis. Removing a spam application must not thereby decline it on the
 *                 owner's behalf, because "we took this down" and "the owner said no" are different
 *                 facts and only one of them is true.
 *
 * The table shows both, side by side and separately labelled, so the screen cannot blur them.
 *
 * `rent` and `perHead` are joined from the live listing on every read rather than stored on the
 * application, so this board can never show a price that stopped being true when the owner edited
 * their listing.
 */
import { useCallback, useState } from 'react';
import { Ban, Check, Flag, Users } from 'lucide-react';
import { listGroupApplications, moderateGroupApplication } from '../../../services/flatmateService.js';
import { fmtNum } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { BoardCount, BoardState, InlineNote, PAGE_SIZE, Pager, fmtDate, usePagedBoard } from './board.jsx';

const ACTIONS = [
  { id: 'approved', label: 'Clear', icon: Check, note: false, tone: 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal' },
  { id: 'flagged', label: 'Flag', icon: Flag, note: true, tone: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  { id: 'removed', label: 'Remove', icon: Ban, note: true, tone: 'border-white/10 text-gray-300 hover:bg-white/5' },
];

/** The server offers no filter on this board, so neither do we — newest first, one page at a time. */
export default function ApplicationsBoard() {
  const { toast } = useToast();
  const [noting, setNoting] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback((page) => listGroupApplications({ page, size: PAGE_SIZE }), []);
  const board = usePagedBoard(load, 'all');

  const apply = async (row, next, why) => {
    try {
      await moderateGroupApplication(row.id, next, why);
      toast(next === 'approved' ? 'Cleared' : `Marked ${next}`, next === 'approved' ? 'success' : 'error');
      setNoting(null);
      setNote('');
      board.reload();
    } catch (e) {
      toast(e.message || 'That decision was refused.', 'error');
    }
  };

  const startOrApply = (row, action) => {
    if (!action.note) { apply(row, action.id); return; }
    setNoting(`${row.id}:${action.id}`);
    setNote('');
  };

  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-300" />
        <div>
          Groups applying to take a whole listing. <b className="text-gray-200">Owner</b> is the owner&apos;s own
          accept or decline and this desk cannot change it — clearing or removing an application says
          only what <b className="text-gray-200">we</b> think of it. Per-head rent is computed from the
          listing on every read, so it is never a stale price.
        </div>
      </div>

      {board.status === 'ready' && (
        <BoardCount total={board.total} singular="group application" plural="group applications" />
      )}

      <BoardState state={board} onRetry={board.reload} empty="No group applications yet 👥" />

      {board.status === 'ready' && board.items.length ? (
        <>
        <div className="dz-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-semibold text-gray-400">
                <th className="p-3">Group</th>
                <th className="p-3">Listing</th>
                <th className="p-3">Rent</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Moderation</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {board.items.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="p-3">
                    <div className="font-semibold">{r.groupTitle || '—'}</div>
                    <div className="text-xs text-gray-400">{r.applicantName || '—'}</div>
                    <div className="text-[11px] text-gray-500">
                      {r.members} of {r.seatsTotal} seats · {fmtDate(r.at)}
                    </div>
                  </td>
                  <td className="p-3 max-w-xs text-gray-300">
                    <div>{r.listingTitle || '—'}</div>
                    <div className="text-xs text-gray-500">{r.locality || '—'}</div>
                  </td>
                  <td className="p-3 text-gray-300">
                    <div>{r.rent == null ? '—' : `₹${fmtNum(r.rent)}`}</div>
                    <div className="text-[11px] text-gray-500">
                      {r.perHead == null ? '—' : `₹${fmtNum(r.perHead)} per head`}
                    </div>
                  </td>
                  <td className="p-3"><Badge status={r.status} /></td>
                  <td className="p-3"><Badge status={r.modStatus} /></td>
                  <td className="p-3">
                    {noting && noting.startsWith(`${r.id}:`) ? (
                      <InlineNote
                        value={note}
                        onChange={setNote}
                        onConfirm={() => apply(r, noting.split(':').pop(), note)}
                        onCancel={() => { setNoting(null); setNote(''); }}
                        placeholder="Internal note (optional)"
                        confirmLabel="Confirm"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {ACTIONS.filter((a) => a.id !== r.modStatus).map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => startOrApply(r, a)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${a.tone}`}
                          >
                            <a.icon className="h-3 w-3" />{a.label}
                          </button>
                        ))}
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
