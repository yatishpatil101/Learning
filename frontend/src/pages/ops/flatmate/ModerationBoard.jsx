/**
 * Board 2 of 3 — **post moderation** (D72). `GET /admin/flatmates/moderation`,
 * `PATCH /admin/flatmates/{id}/moderation`.
 *
 * The question is *may this be published at all?* and the answer is visibility. Every newly written
 * post, room and group starts `pending`: visible to its author, to nobody else. That is only
 * defensible because this screen exists — without it "moderated before public" means "never
 * public", which is a worse outcome for honest supply than the unmoderated board was. **This board
 * is the queue that makes D72 legitimate**, and it had no UI at all until now.
 *
 * ## `freeText` is the point of the screen
 *
 * `title`, `note` and `locality` are unbounded strings, and a broker who cannot publish a phone
 * number in the contact field types it into one of those instead. So the free text is rendered in
 * full and never truncated — a row showing only a headline and a price would pass through exactly
 * the abuse the queue was built to catch.
 *
 * ## One kind per call
 *
 * Posts, rooms and groups are three tables. A merged board would have to load every pending row to
 * sort it in memory, or report a `totalElements` true of one table and false of the screen. The
 * server asks which board you want, so the page asks too.
 */
import { useCallback, useState } from 'react';
import { Ban, Check, Flag, ShieldAlert } from 'lucide-react';
import { listFlatmateModeration, moderateFlatmatePost } from '../../../services/flatmateService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { BoardCount, BoardState, InlineNote, PAGE_SIZE, Pager, Tabs, fmtDate, usePagedBoard } from './board.jsx';

const KINDS = [
  { id: 'post', label: 'Seeker posts' },
  { id: 'room', label: 'Rooms' },
  { id: 'group', label: 'Groups' },
];

/**
 * Four of the six `MOD_STATUS` words.
 *
 * `live` is the pre-D72 state: every row written under the old "visible the instant it is written"
 * rule still carries it, and those posts were published under a policy their authors could not have
 * known would change. It gets a tab so "what can the city see right now?" has an answer, but no
 * button — pulling that backlog into a queue retroactively would punish people for our decision.
 *
 * `rejected` is absent deliberately. It is in the shared vocabulary and the server would accept it,
 * but on this axis it means exactly what `removed` means, and two words for "not published" is an
 * invitation for a desk to use them inconsistently and then be unable to report on either.
 */
const STATES = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Published' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'removed', label: 'Removed' },
  { id: 'live', label: 'Live (pre-D72)' },
];

/** Publishing needs no explanation; withholding does, and the audit row is where it lives. */
const ACTIONS = [
  { id: 'approved', label: 'Publish', icon: Check, note: false, tone: 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal' },
  { id: 'flagged', label: 'Flag', icon: Flag, note: true, tone: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  { id: 'removed', label: 'Remove', icon: Ban, note: true, tone: 'border-white/10 text-gray-300 hover:bg-white/5' },
];

export default function ModerationBoard() {
  const { toast } = useToast();
  const [kind, setKind] = useState('post');
  const [modStatus, setModStatus] = useState('pending');
  const [noting, setNoting] = useState(null); // `${id}:${modStatus}` being annotated
  const [note, setNote] = useState('');

  const load = useCallback(
    (page) => listFlatmateModeration({ kind, modStatus, page, size: PAGE_SIZE }),
    [kind, modStatus],
  );
  const board = usePagedBoard(load, `${kind}:${modStatus}`);

  const apply = async (row, next, why) => {
    try {
      await moderateFlatmatePost(row.id, next, why);
      toast(next === 'approved' ? 'Published — it is on the board now' : `Marked ${next}`, next === 'approved' ? 'success' : 'error');
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
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/5 p-4 text-sm text-gray-300">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <div>
          Everything written here starts <b className="text-gray-200">Pending</b> — visible to its author and
          to nobody else — so this queue is the only thing standing between honest supply and a board
          nobody can post to. Read the <b className="text-gray-200">free text</b>: that is where a contact
          number goes when the contact field will not take one. Publishing does
          {' '}<b className="text-gray-200">not</b> grant a trust badge; that is <b className="text-gray-200">Verification</b>.
        </div>
      </div>

      <Tabs tabs={KINDS} active={kind} onChange={setKind} label="Which board" />
      <Tabs tabs={STATES} active={modStatus} onChange={setModStatus} label="Moderation states" />
      {board.status === 'ready' && (
        <BoardCount total={board.total} singular="entry" plural="entries" />
      )}

      <BoardState state={board} onRetry={board.reload} empty="Nothing waiting on this board ✅" />

      {board.status === 'ready' && board.items.length ? (
        <>
        <div className="dz-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-semibold text-gray-400">
                <th className="p-3">Author</th>
                <th className="p-3">Headline</th>
                <th className="p-3">What they typed</th>
                <th className="p-3">State</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {board.items.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="p-3">
                    <div className="font-semibold">{r.authorName || '—'}</div>
                    <div className="text-[11px] text-gray-500">{fmtDate(r.createdAt)}</div>
                  </td>
                  <td className="p-3 max-w-xs text-gray-300">
                    <div>{r.headline || '—'}</div>
                    <div className="text-xs text-gray-500">{r.locality || '—'}</div>
                  </td>
                  {/* Never truncated, never collapsed behind a "show more" — see the header. */}
                  <td className="p-3 max-w-md whitespace-pre-wrap break-words text-gray-300">
                    {r.freeText || <span className="text-gray-500">—</span>}
                  </td>
                  <td className="p-3"><Badge status={r.modStatus} /></td>
                  <td className="p-3">
                    {noting && noting.startsWith(`${r.id}:`) ? (
                      <InlineNote
                        value={note}
                        onChange={setNote}
                        onConfirm={() => apply(r, noting.split(':').pop(), note)}
                        onCancel={() => { setNoting(null); setNote('' ); }}
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
