import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, BadgeCheck, Ban, Building2, CalendarCheck, CheckCircle2, ConciergeBell, Download, Eye, Flag, Mail, MessageSquareText, RotateCcw, ShieldCheck, ShieldAlert, UserPlus } from 'lucide-react';
import { listUsers, getUserTimeline, setUserBadge, setUserStatus, setUserFlag } from '../../services/usersService.js';
import { addNote, listNotes } from '../../services/noteService.js';
import { MAX_PAGE_SIZE } from '../../services/apiLimits.js';
import { fmtNum, classNames, timeAgo, avatarFor } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Modal from '../../components/ui/Modal.jsx';

const ROLE_OPTS = [
  { value: '', label: 'All roles' },
  { value: 'owner', label: 'Owners' },
  { value: 'buyer', label: 'Buyers' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
];
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'archived', label: 'Archived' },
];

/**
 * How each confirmable action is worded and what it needs before Confirm is allowed.
 *
 * `requiresReason` is not a house style. The server enforces it — a flag without a reason is a 422,
 * and the database carries a matching check constraint — so a Confirm button that stayed enabled
 * would submit a request that could only fail. Suspension and archiving take an optional reason
 * because a moderator acting on something obvious should not have to type prose to stop an abuser.
 */
const ACTION_COPY = {
  verifyGrant: { title: 'Grant Verified badge', requiresReason: true, hint: 'Say what you checked. The badge is a claim the platform makes on this person\u2019s behalf.' },
  verifyRemove: { title: 'Remove Verified badge', requiresReason: true, hint: 'Say what changed. Removing a badge is visible to everyone browsing their listings.' },
  suspend: { title: 'Suspend user', requiresReason: false, hint: 'Ends every signed-in session and refuses new sign-ins until reactivated. The account stays in the directory.' },
  reactivate: { title: 'Reactivate user', requiresReason: false, hint: 'Lets them sign in again. Sessions are not restored; they will need to log in.' },
  flagRaise: { title: 'Flag for review', requiresReason: true, hint: 'A note between colleagues. It changes nothing the platform does \u2014 it records what you noticed so the next moderator inherits it.' },
  flagClear: { title: 'Remove flag', requiresReason: false, hint: 'The reason is forgotten. The history stays in the audit log.' },
  archive: { title: 'Archive user', requiresReason: false, hint: 'Removes the account from the directory. It does not stop them signing in \u2014 suspend for that.' },
  restore: { title: 'Restore user', requiresReason: false, hint: 'Returns the account to the directory as active.' },
};

/** Icon, dot and text colour per timeline `kind`. */
const TIMELINE_STYLES = {
  account: { icon: UserPlus, dot: 'bg-emerald-400', color: 'text-emerald-300', title: 'Joined PuneNest' },
  enquiry: { icon: Mail, dot: 'bg-teal-400', color: 'text-teal-300', title: 'Sent an enquiry' },
  visit: { icon: CalendarCheck, dot: 'bg-sky-400', color: 'text-sky-300', title: 'Booked a visit' },
  service: { icon: ConciergeBell, dot: 'bg-amber-400', color: 'text-amber-300', title: 'Requested a service' },
  listing: { icon: Building2, dot: 'bg-indigo-400', color: 'text-indigo-300', title: 'Listed a property' },
  moderation: { icon: ShieldAlert, dot: 'bg-rose-400', color: 'text-rose-300', title: 'Moderation action' },
};

export default function AdminUsers() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [actionModal, setActionModal] = useState(null); // { user, action, copy }
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [timelineUser, setTimelineUser] = useState(null);
  const [timeline, setTimeline] = useState(null); // null = still loading
  /* Notes on this person (D29). Separate from `timeline` because they are a separate route with a
     separate audience: the timeline is admin-only and has no `note` kind, and these are written by
     staff who must be able to read them back. null = still loading. */
  const [userNotes, setUserNotes] = useState(null);
  const [userNoteDraft, setUserNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Guards every post-await setState. Re-armed in the effect body, not merely cleared in cleanup:
  // under StrictMode a mount/unmount/re-mount would otherwise leave it false forever and silently
  // swallow the first load.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /**
   * One request per filter change, not one big fetch filtered in the browser.
   *
   * The old page loaded every account once and did all three filters client-side, which is why the
   * "Suspended" option had to be simulated: there was no server-side status filter to ask for. Now
   * there is, and asking for it is also the only way the counts under the heading can be true \u2014 a
   * client-side filter can only ever count what it was given.
   */
  const load = useCallback(async () => {
    const page = await listUsers({ role, status, q: q.trim(), page: 0, size: MAX_PAGE_SIZE });
    if (!alive.current) return;
    setRows(page.items);
    setTotal(page.total);
  }, [role, status, q]);

  // Debounced, because `q` changes on every keystroke and each change is a request.
  useEffect(() => {
    const id = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(id);
  }, [load]);

  const openAction = (user, action) => { setActionModal({ user, action, copy: ACTION_COPY[action] }); setNoteText(''); };
  const closeAction = () => setActionModal(null);

  const openTimeline = async (user) => {
    if (!optionEnabled('users.timeline')) return;
    setTimelineUser(user);
    setTimeline(null);
    setUserNotes(null);
    setUserNoteDraft('');
    /* Two reads, deliberately not awaited together: a timeline that fails must not blank the notes,
       and vice versa. They answer different questions about the same person. */
    listNotes('user', user.id)
      .then((rows) => { if (alive.current) setUserNotes(rows); })
      .catch(() => { if (alive.current) setUserNotes([]); });
    try {
      const entries = await getUserTimeline(user.id);
      if (alive.current) setTimeline(entries);
    } catch {
      if (alive.current) { setTimeline([]); toast('Could not load this user\u2019s activity', 'error'); }
    }
  };
  const closeTimeline = () => { setTimelineUser(null); setTimeline(null); setUserNotes(null); setUserNoteDraft(''); };

  /**
   * File a note against this person.
   *
   * No `action` label: the four listing notes are filed beside a decision and say which one, but a
   * note written here is the whole of what happened. Labelling it "Note" would add a word and no
   * information.
   *
   * The list is refetched rather than optimistically prepended, because the server decides the id,
   * the timestamp and the byline — and the byline is the point of the panel.
   */
  const submitUserNote = async () => {
    const text = userNoteDraft.trim();
    if (!text || !timelineUser || savingNote) return;
    setSavingNote(true);
    try {
      await addNote('user', timelineUser.id, text);
      const rows = await listNotes('user', timelineUser.id);
      if (alive.current) { setUserNotes(rows); setUserNoteDraft(''); }
    } catch (err) {
      toast(err?.message || 'Could not save that note', 'error');
    } finally {
      if (alive.current) setSavingNote(false);
    }
  };

  /**
   * Every action ends in a reload rather than a local patch.
   *
   * Two of the four routes return no body, and the two that do return the whole account \u2014 including
   * fields this row does not carry. Re-reading the page is cheaper to reason about than four
   * different merge rules, and it is the only version that stays correct when the server refuses:
   * a rejected suspension leaves the row exactly as the server still has it, rather than as the
   * click assumed it would be.
   */
  const confirmAction = async () => {
    if (busy || !actionModal) return;
    const { user: u, action, copy } = actionModal;
    if (copy.requiresReason && !noteText.trim()) return;
    setBusy(true);
    const reason = noteText.trim();
    try {
      switch (action) {
        case 'verifyGrant':
        case 'verifyRemove':
          await setUserBadge(u.id, action === 'verifyGrant', reason);
          toast(action === 'verifyGrant' ? 'Verified badge granted' : 'Verified badge removed');
          break;
        case 'suspend':
          await setUserStatus(u.id, 'suspend', reason);
          toast('User suspended \u2014 their sessions have been ended', 'warning');
          break;
        case 'reactivate':
          await setUserStatus(u.id, 'reactivate');
          toast('User reactivated', 'success');
          break;
        case 'flagRaise':
        case 'flagClear':
          await setUserFlag(u.id, action === 'flagRaise', reason);
          toast(action === 'flagRaise' ? 'User flagged for review' : 'Flag removed');
          break;
        case 'archive':
          await setUserStatus(u.id, 'archive', reason);
          toast('User archived');
          break;
        case 'restore':
          await setUserStatus(u.id, 'restore');
          toast('User restored', 'success');
          break;
        default:
          break;
      }
      closeAction();
      await load();
    } catch (err) {
      // The server's own sentence, not a generic failure: it is the only place that knows *why*.
      // "This account is archived, not suspended" tells the moderator what to do next; "Something
      // went wrong" sends them to look for a bug that is not there.
      toast(err?.message || 'That could not be done', 'error');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const list = rows || [];
  const truncated = total > list.length;

  const doExport = () =>
    exportCsv(
      'punenest-users.csv',
      ['ID', 'Name', 'Mobile', 'Role', 'City', 'Listings', 'Joined', 'Verified', 'Status'],
      list.map((u) => [u.id, u.name, u.mobile, u.role, u.city, u.listings || 0, u.joinedAt, u.verified ? 'Yes' : 'No', u.status]),
    );

  const actionButtons = (u) => (
    <>
      {optionEnabled('users.timeline') && (
        <button onClick={() => openTimeline(u)} title="View activity" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-indigo-500/15 hover:text-indigo-300 hover:border-indigo-400/30">
          <Eye className="h-4 w-4" />
        </button>
      )}
      {/* An Aadhaar-earned badge cannot be withdrawn by hand \u2014 the server answers 409 and nothing
          would restore it. Disabling the button with the reason attached is more use than a
          control that can only fail. */}
      <button
        onClick={() => openAction(u, u.verified ? 'verifyRemove' : 'verifyGrant')}
        disabled={u.verified && u.aadhaarVerified}
        title={u.verified && u.aadhaarVerified ? 'Verified through Aadhaar \u2014 cannot be removed by hand' : u.verified ? 'Remove Verified badge' : 'Grant Verified badge'}
        className={classNames('rounded-lg border p-1.5 disabled:opacity-40 disabled:cursor-not-allowed', u.verified ? 'border-brand-teal/40 bg-brand-teal/15 text-brand-teal' : 'border-white/10 text-gray-400 hover:bg-white/5')}
      >
        <ShieldCheck className="h-4 w-4" />
      </button>
      <button onClick={() => openAction(u, u.status === 'suspended' ? 'reactivate' : 'suspend')} disabled={u.archived} title={u.archived ? 'Restore the account before changing its status' : u.status === 'suspended' ? 'Reactivate' : 'Suspend'} className={classNames('rounded-lg border p-1.5 disabled:opacity-40 disabled:cursor-not-allowed', u.status === 'suspended' ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' : 'border-red-400/30 bg-red-500/15 text-red-300')}>
        {u.status === 'suspended' ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      </button>
      <button onClick={() => openAction(u, u.flagged ? 'flagClear' : 'flagRaise')} title={u.flagged ? `Remove flag${u.flagReason ? ` \u2014 ${u.flagReason}` : ''}` : 'Flag for review'} className={classNames('rounded-lg border p-1.5', u.flagged ? 'border-amber-400/30 bg-amber-500/15 text-amber-300' : 'border-white/10 text-gray-400 hover:bg-white/5')}>
        <Flag className="h-4 w-4" />
      </button>
      {u.archived ? (
        <button onClick={() => openAction(u, 'restore')} title="Restore user" className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 p-1.5 text-emerald-300">
          <RotateCcw className="h-4 w-4" />
        </button>
      ) : (
        <button onClick={() => openAction(u, 'archive')} title="Archive user" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-400/30">
          <Archive className="h-4 w-4" />
        </button>
      )}
    </>
  );

  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div>
          <div className="flex items-center gap-1.5 font-semibold">
            {u.name || 'Unnamed'}
            {u.verified ? <BadgeCheck className="h-4 w-4 text-brand-teal" /> : null}
            {u.flagged ? <Flag className="h-3.5 w-3.5 text-amber-300" /> : null}
          </div>
          {/* Masked on purpose: the full number lives behind a route that logs the reveal, so the
              directory does not offer it and cannot become a bulk export. */}
          <div className="text-xs text-gray-400">{u.mobile}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <span className="capitalize">{u.role}</span> },
    { key: 'city', header: 'City', render: (u) => u.city || '\u2014' },
    { key: 'listings', header: 'Listings', render: (u) => fmtNum(u.listings || 0) },
    { key: 'joinedAt', header: 'Joined', render: (u) => (u.joinedAt ? timeAgo(u.joinedAt) : '\u2014') },
    { key: 'status', header: 'Status', render: (u) => <Badge status={u.status} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right whitespace-nowrap',
      render: (u) => <div className="flex justify-end gap-1.5">{actionButtons(u)}</div>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [optionEnabled]);

  const userCard = (u) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{u.name || 'Unnamed'}</span>
            {u.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-teal" /> : null}
            {u.flagged ? <Flag className="h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">{u.mobile}</div>
        </div>
        <div className="shrink-0"><Badge status={u.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span className="capitalize text-gray-300">{u.role}</span>
        {u.city ? (<><span className="text-gray-600">·</span><span>{u.city}</span></>) : null}
        <span className="text-gray-600">·</span>
        <span>{fmtNum(u.listings || 0)} listings</span>
        {u.joinedAt ? (<><span className="text-gray-600">·</span><span>Joined {timeAgo(u.joinedAt)}</span></>) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
        {actionButtons(u)}
      </div>
    </div>
  );

  if (rows === null) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={truncated
          ? `Showing ${fmtNum(list.length)} of ${fmtNum(total)} matching accounts — narrow the filters to see the rest.`
          : `${fmtNum(total)} accounts — owners, buyers and staff.`}
        actions={
          optionEnabled('users.csvExport') && (
            <button onClick={doExport} className="pn-btn pn-btn-ghost">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, email…" className="pn-input sm:w-64" />
        <Select value={role} onChange={setRole} options={ROLE_OPTS} className="sm:w-40" ariaLabel="Filter by role" />
        <Select value={status} onChange={setStatus} options={STATUS_OPTS} className="sm:w-40" ariaLabel="Filter by status" />
      </div>

      <Table columns={columns} rows={list} pageSize={10} label="users" empty="No users match these filters." mobileCard={userCard} />

      <Modal
        open={!!actionModal}
        onClose={closeAction}
        title={actionModal?.copy?.title || 'Confirm action'}
        footer={
          <>
            <button onClick={closeAction} className="pn-btn pn-btn-ghost">Cancel</button>
            <button
              onClick={confirmAction}
              disabled={busy || (actionModal?.copy?.requiresReason && !noteText.trim())}
              className="pn-btn pn-btn-primary disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </>
        }
      >
        {actionModal && (
          <>
            <p className="text-sm text-gray-400">
              {actionModal.copy.title} <span className="font-medium text-gray-200">{actionModal.user.name || actionModal.user.mobile}</span>?
            </p>
            <p className="mt-2 text-xs text-gray-500">{actionModal.copy.hint}</p>
            {/* Not the shared `InternalNote` widget, deliberately. That one is collapsed behind an
                "Internal note (optional)" toggle and reads its history from the browser's own
                database — both wrong here. The reason is not a note *about* the action, it IS the
                request field, mandatory for a flag and a badge, and the server is the only place it
                is kept. A control the operator has to discover before they can proceed is a control
                in the wrong shape. */}
            <label className="mt-3 block">
              <span className="text-xs text-gray-400">
                Reason {actionModal.copy.requiresReason ? <span className="text-amber-300">(required)</span> : '(optional)'}
              </span>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                placeholder="Add a note for the team… (visible only to admins and staff)"
                className="mt-1 pn-input resize-none text-sm"
              />
            </label>
            {actionModal.copy.requiresReason && !noteText.trim() && (
              <p className="mt-1 text-xs text-amber-300">A reason is required for this action.</p>
            )}
          </>
        )}
      </Modal>

      {optionEnabled('users.timeline') && (
        <Modal open={!!timelineUser} onClose={closeTimeline} title={timelineUser ? `Activity — ${timelineUser.name || timelineUser.mobile}` : ''} size="lg">
          {timelineUser && (
            <div>
              <div className="mb-4 flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/15 text-indigo-300 text-lg font-bold">
                  {avatarFor(timelineUser.name || '?')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{timelineUser.name || 'Unnamed'}</span>
                    {timelineUser.verified && <BadgeCheck className="h-4 w-4 text-brand-teal" />}
                    <Badge status={timelineUser.status} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{timelineUser.mobile} · {timelineUser.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-white">{timeline?.length ?? '—'}</div>
                  <div className="text-xs text-gray-500">activities</div>
                </div>
              </div>

              {/* Staff notes on this person (D29). Above the timeline because it is the only part
                  of this drawer anyone can add to, and because it is what a colleague picking up
                  the case needs first. Deliberately inter-transparent: any staff or admin reads
                  every note here, whoever wrote it. */}
              <div data-testid="user-notes" className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-200">
                  <MessageSquareText className="h-4 w-4 text-indigo-400" /> Staff notes
                  {userNotes && (
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">{userNotes.length}</span>
                  )}
                </div>
                <div className="mt-3 flex items-start gap-2">
                  <textarea
                    value={userNoteDraft}
                    onChange={(e) => setUserNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="What should the next person know about this account?"
                    aria-label="Add a staff note"
                    className="pn-input resize-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={submitUserNote}
                    disabled={savingNote || !userNoteDraft.trim()}
                    className="pn-btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-40"
                  >
                    {savingNote ? 'Saving…' : 'Add note'}
                  </button>
                </div>
                {userNotes === null ? (
                  <div className="mt-3 text-xs text-gray-500">Loading notes…</div>
                ) : userNotes.length > 0 ? (
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {userNotes.map((n) => (
                      <div key={n.id} data-testid="user-note" className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-xs leading-relaxed">
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span className="font-medium text-gray-300">{n.author}</span>
                          {n.at && <span>{timeAgo(n.at)}</span>}
                          {n.editedAt && <span className="italic">edited</span>}
                        </div>
                        <p className="mt-0.5 text-gray-400">{n.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-gray-500">Nobody has written a note about this account yet.</div>
                )}
              </div>

              {timeline === null ? (
                <Loading />
              ) : timeline.length > 0 ? (
                <div className="relative pl-6 border-l border-white/10 max-h-[60vh] overflow-y-auto space-y-4">
                  {/* The server sends facts, not sentences \u2014 { kind, entityId, at, label, status } \u2014
                      so the wording is chosen here, where the operator's language is known. `label`
                      is the source row's own name for itself and is rendered as-is. */}
                  {timeline.map((entry, i) => {
                    const styles = TIMELINE_STYLES[entry.kind] || { icon: Mail, dot: 'bg-gray-400', color: 'text-gray-300', title: 'Activity' };
                    const Icon = styles.icon;
                    return (
                      <div key={`${entry.kind}-${entry.entityId}-${entry.at}-${i}`} className="relative">
                        <div className={`absolute -left-[25px] top-1 h-3 w-3 rounded-full border-2 border-ink ${styles.dot}`} />
                        <div className="flex items-start gap-3">
                          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 ${styles.color}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-semibold ${styles.color}`}>{styles.title}</span>
                              {entry.status && <Badge status={entry.status} />}
                            </div>
                            {entry.label && <p className="text-sm text-gray-400 mt-0.5 truncate">{entry.label}</p>}
                            <div className="text-[11px] text-gray-500 mt-1">{timeAgo(entry.at)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-500">No activity recorded for this user yet.</div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
