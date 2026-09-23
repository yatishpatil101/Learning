/* The question is *may this be published at all?* Free text and photos are rendered in full and
   never truncated — a broker blocked from the contact field types the number into `title` or `note`. */
import { useCallback, useState } from 'react';
import { Ban, Check, EyeOff, ShieldAlert } from 'lucide-react';
import { listFlatmateModeration, moderateFlatmatePost } from '../../../services/flatmateService.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { BoardCount, BoardState, InlineNote, PAGE_SIZE, Pager, Tabs, fmtDate, usePagedBoard } from './board.jsx';

const KINDS = [
  { id: 'post', label: 'Seeker posts' },
  { id: 'room', label: 'Rooms' },
  { id: 'group', label: 'Groups' },
];

/* `live` is published without a moderator, `approved` is the one a human typed — both public, and
   the difference matters only here. `recheck` is not a `MOD_STATUS`: it surfaces an edit to a
   published row. `rejected` is omitted deliberately; on this axis it duplicates `removed`. */
const STATES = [
  { id: 'pending', label: 'Pending' },
  { id: 'recheck', label: 'Re-check' },
  { id: 'approved', label: 'Published' },
  { id: 'flagged', label: 'Hidden for review' },
  { id: 'removed', label: 'Removed' },
  { id: 'live', label: 'Live (unread)' },
];

/** Publishing needs no explanation; withholding does, and the audit row is where it lives. */
const ACTIONS = [
  { id: 'approved', label: 'Publish', icon: Check, note: false, tone: 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal' },
  { id: 'flagged', label: 'Hide for review', icon: EyeOff, note: true, tone: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  { id: 'removed', label: 'Remove', icon: Ban, note: true, tone: 'border-white/10 text-gray-300 hover:bg-white/5' },
];

/* Hide the action a row is already in — except on a re-check row, which is public by definition, so
   the rule would filter away the only verdict that says *I have read the edit and it is fine*. */
const actionsFor = (row) => ACTIONS.filter((a) => a.id !== row.modStatus || row.recheckRequestedAt)
  .map((a) => (a.id === row.modStatus ? { ...a, label: 'Looks fine', note: false } : a));

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
      // Re-stamping the state a row is already in is the "Looks fine" verdict, and saying
      // "Published" for it would claim an outcome the moderator did not cause.
      const settled = row.modStatus === next;
      const published = next === 'approved';
      toast(
        settled ? 'Re-check cleared' : published ? 'Published — it is on the board now' : `Marked ${next}`,
        settled || published ? 'success' : 'error',
      );
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
          {' '}<b className="text-gray-200">not</b> grant a trust badge; that is <b className="text-gray-200">Verification</b>,
          which is also the only board that says <b className="text-gray-200">Contested address</b> — a
          guardrail, not a verdict, and nothing to do with hiding a post here.
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
                {kind === 'room' ? <th className="p-3">Photos</th> : null}
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
                  {/* All of them, never a "+9 more": the one that was swapped in is as likely to
                      be last as first, and a moderator who has to click cannot scan. A post and a
                      group carry none, so the column only exists on the board that has them. */}
                  {kind === 'room' ? (
                    <td className="p-3 flatmate-mod-photos">
                      {r.photos.length ? (
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {/* Index, not the URL: nothing de-duplicates the list, and a host who
                              uploads the same file twice would otherwise collide two keys. */}
                          {r.photos.map((src, i) => (
                            <a key={i} href={src} target="_blank" rel="noreferrer noopener">
                              <img
                                src={src}
                                alt={`${i + 1} of ${r.photos.length}`}
                                loading="lazy"
                                decoding="async"
                                width={48}
                                height={48}
                                className="h-12 w-12 rounded object-cover ring-1 ring-white/10"
                              />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  ) : null}
                  <td className="p-3">
                    <Badge status={r.modStatus}>
                      {r.modStatus === 'flagged' ? 'Hidden for review' : null}
                    </Badge>
                    {/* Keyed off the timestamp, not the reason: the server's own presence test is
                        `recheck_requested_at is not null`, and a row whose reason list came back
                        empty would otherwise sit on this tab wearing no marker at all. */}
                    {r.recheckRequestedAt ? (
                      <div className="mt-1 text-[11px] text-amber-300 flatmate-mod-recheck">
                        Edited since review: {r.recheckReason || 'edited'} · {fmtDate(r.recheckRequestedAt)}
                      </div>
                    ) : null}
                  </td>
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
                        {actionsFor(r).map((a) => (
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
