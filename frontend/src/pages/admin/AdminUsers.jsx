import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, BadgeCheck, Ban, Building2, CalendarCheck, CheckCircle2, ConciergeBell, Download, Eye, Flag, Mail, MessageSquareText, RotateCcw, ShieldCheck, ShieldAlert, UserPlus } from 'lucide-react';
import {
  getUserTimeline,
  listBadgeGrants,
  listUsers,
  setUserBadge,
  setUserFlag,
  setUserStatus,
} from '../../services/usersService.js';
import { addNote, listNotes } from '../../services/noteService.js';
import { MAX_PAGE_SIZE } from '../../services/apiLimits.js';
import { fmtNum, classNames, timeAgo, avatarFor } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Modal from '../../components/ui/Modal.jsx';
import {
  BTN, CHIP, CHIP_TONE, Cell, Chips, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox,
} from '../../components/admin/WorkQueue.jsx';
import BadgeApprovals from './BadgeApprovals.jsx';

const ROLE_CHIPS = [
  { value: '', label: 'All' },
  { value: 'owner', label: 'Owners' },
  { value: 'buyer', label: 'Buyers' },
];
const STATUS_TABS = [
  { key: 'all', label: 'All users', status: '', note: 'Every owner and buyer account that is not archived.' },
  { key: 'active', label: 'Active', status: 'active', note: 'Accounts that can sign in.' },
  { key: 'suspended', label: 'Suspended', status: 'suspended', note: 'Signed out and refused sign-in until reactivated.' },
  { key: 'archived', label: 'Archived', status: 'archived', note: 'Out of the directory and refused sign-in until restored.' },
];
const BADGES_NOTE = 'Hand-granted Verified badges need a second admin to approve.';
const PAGE_SIZE = 20;
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/* `requiresReason` mirrors a server 422 and a database check constraint, so a Confirm button that
   stayed enabled would submit a request that could only fail. */
const ACTION_COPY = {
  verifyGrant: { title: 'Grant Verified badge', requiresReason: true, minReason: 10, hint: 'Say what you checked. The badge is a claim the platform makes on this person\u2019s behalf.' },
  verifyRemove: { title: 'Remove Verified badge', requiresReason: true, minReason: 10, hint: 'Say what changed. Removing a badge is visible to everyone browsing their listings.' },
  suspend: { title: 'Suspend user', requiresReason: false, hint: 'Ends every signed-in session and refuses new sign-ins until reactivated. The account stays in the directory.' },
  reactivate: { title: 'Reactivate user', requiresReason: false, hint: 'Lets them sign in again. Sessions are not restored; they will need to log in.' },
  flagRaise: { title: 'Flag for review', requiresReason: true, hint: 'A note between colleagues. It changes nothing the platform does \u2014 it records what you noticed so the next moderator inherits it.' },
  flagClear: { title: 'Remove flag', requiresReason: false, hint: 'The reason is forgotten. The history stays in the audit log.' },
  archive: { title: 'Archive user', requiresReason: false, hint: 'Removes the account from the directory, ends every signed-in session and refuses sign-in until restored.' },
  restore: { title: 'Restore user', requiresReason: false, hint: 'Returns the account to the directory as active.' },
};
const reasonMissing = (copy, text) => !!copy?.requiresReason && text.trim().length < (copy.minReason || 1);

/** Icon, dot and text colour per timeline `kind`. */
const TIMELINE_STYLES = {
  account: { icon: UserPlus, dot: 'bg-emerald-400', color: 'text-emerald-300', title: 'Joined Draazy' },
  enquiry: { icon: Mail, dot: 'bg-teal-400', color: 'text-teal-300', title: 'Sent an enquiry' },
  visit: { icon: CalendarCheck, dot: 'bg-sky-400', color: 'text-sky-300', title: 'Booked a visit' },
  service: { icon: ConciergeBell, dot: 'bg-amber-400', color: 'text-amber-300', title: 'Requested a service' },
  listing: { icon: Building2, dot: 'bg-indigo-400', color: 'text-indigo-300', title: 'Listed a property' },
  moderation: { icon: ShieldAlert, dot: 'bg-rose-400', color: 'text-rose-300', title: 'Moderation action' },
};

export default function AdminUsers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { optionEnabled } = useAdminFlags();
  const isAdmin = user?.role === 'admin';
  const canManageBadges = isAdmin && hasPermission(user, 'users:write');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [pendingBadgeGrants, setPendingBadgeGrants] = useState(null);
  const [tab, setTab] = useTabParam([...STATUS_TABS.map((t) => t.key), ...(canManageBadges ? ['badges'] : [])], 'all');
  const status = STATUS_TABS.find((t) => t.key === tab)?.status ?? '';
  const [counts, setCounts] = useState({});
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const resetKey = `${tab}|${role}|${q}`;
  const [pageState, setPageState] = useState({ page: 1, key: resetKey });
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageState.key === resetKey ? pageState.page : 1, lastPage);
  const [actionModal, setActionModal] = useState(null); // { user, action, copy }
  const [actionError, setActionError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [timelineUser, setTimelineUser] = useState(null);
  const [timeline, setTimeline] = useState(null); // null = still loading
  /* Separate from `timeline`: a separate route with a separate audience, since the timeline is
     admin-only and has no `note` kind. null = still loading. */
  const [userNotes, setUserNotes] = useState(null);
  const [userNoteDraft, setUserNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Guards every post-await setState. Re-armed in the effect body rather than only cleared in
  // cleanup, or StrictMode's mount/unmount/re-mount leaves it false forever.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /* Counts ignore status and paging, so fetch them only when role or search changed, or after an action. */
  const countsKey = useRef(null);
  const load = useCallback(async (recount = false) => {
    const key = `${role}|${q.trim()}`;
    const counts = recount === true || countsKey.current !== key;
    const res = await listUsers({ role, customers: true, status, q: q.trim(), page: page - 1, size: PAGE_SIZE, counts });
    if (!alive.current) return;
    setRows(res.items);
    setTotal(res.total);
    if (counts) {
      countsKey.current = key;
      setCounts(res.counts || {});
    }
  }, [role, status, q, page]);

  const loadGrants = useCallback(async () => {
    try {
      const grants = await listBadgeGrants({ status: 'pending', size: 50 });
      if (alive.current) setPendingBadgeGrants(grants.items || []);
    } catch (err) {
      toast(err?.message || 'Could not load badge approvals', 'error');
      if (alive.current) setPendingBadgeGrants((current) => current || []);
    }
  }, [toast]);

  // The pending list is the badges tab's own; the row pill and the tab count ride on the users list.
  useEffect(() => {
    if (canManageBadges && tab === 'badges') loadGrants();
  }, [canManageBadges, tab, loadGrants]);

  const reloadBadges = useCallback(() => Promise.all([load(true), loadGrants()]), [load, loadGrants]);

  // Debounced, because `q` changes on every keystroke and each change is a request.
  useEffect(() => {
    const id = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(id);
  }, [load]);

  const openAction = useCallback((targetUser, action) => { setActionModal({ user: targetUser, action, copy: ACTION_COPY[action] }); setNoteText(''); setActionError(''); }, []);
  const closeAction = () => { setActionModal(null); setActionError(''); };

  const openTimeline = useCallback(async (targetUser) => {
    setTimelineUser(targetUser);
    setTimeline(null);
    setUserNotes(null);
    setUserNoteDraft('');
    /* Two reads, deliberately not awaited together: a timeline that fails must not blank the notes,
       and vice versa. They answer different questions about the same person. */
    listNotes('user', targetUser.id)
      .then((rows) => { if (alive.current) setUserNotes(rows); })
      .catch(() => { if (alive.current) setUserNotes([]); });
    try {
      const entries = await getUserTimeline(targetUser.id);
      if (alive.current) setTimeline(entries);
    } catch {
      if (alive.current) { setTimeline([]); toast('Could not load this user\u2019s activity', 'error'); }
    }
  }, [toast]);
  const closeTimeline = () => { setTimelineUser(null); setTimeline(null); setUserNotes(null); setUserNoteDraft(''); };

  /* Refetched rather than optimistically prepended: the server decides the id, the timestamp and
     the byline, and the byline is the point of the panel. */
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

  /* Every action ends in a reload rather than a local patch: the four routes return nothing or the
     whole account, and a reload stays correct when the server refuses the change. */
  const confirmAction = async () => {
    if (busy || !actionModal) return;
    const { user: u, action, copy } = actionModal;
    if (reasonMissing(copy, noteText)) return;
    setBusy(true);
    const reason = noteText.trim();
    setActionError('');
    try {
      switch (action) {
        case 'verifyGrant':
        case 'verifyRemove': {
          const result = await setUserBadge(u.id, action === 'verifyGrant', reason);
          if (result?.pending) {
            toast('Sent for approval by another admin');
          } else {
            toast(action === 'verifyGrant' ? 'Verified badge granted' : 'Verified badge removed');
          }
          break;
        }
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
      await load(true);
    } catch (err) {
      const message = err?.message || 'That could not be done';
      setActionError(message);
      toast(message, 'error');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const list = rows || [];

  const doExport = async () => {
    try {
      const all = await listUsers({ role, customers: true, status, q: q.trim(), page: 0, size: MAX_PAGE_SIZE });
      exportCsv(
        'draazy-users.csv',
        ['ID', 'Name', 'Mobile', 'Role', 'City', 'Listings', 'Joined', 'Verified', 'Status'],
        all.items.map((u) => [u.id, u.name, u.mobile, u.role, u.city, u.listings || 0, u.joinedAt, u.verified ? 'Yes' : 'No', u.status]),
      );
    } catch (err) {
      toast(err?.message || 'Could not export the users', 'error');
    }
  };

  const paging = { page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, size: PAGE_SIZE, onPage: (p) => setPageState({ page: p, key: resetKey }) };

  const actionButtons = (u) => {
    const pendingGrant = u.badgePending;
    const earnedBadge = u.verified && u.badgeSource === 'identity';
    const suspended = u.status === 'suspended';
    const badgeTitle = pendingGrant ? 'Badge approval pending'
      : earnedBadge ? 'Earned through identity review — revoke it from the KYC review record'
        : u.verified ? 'Remove Verified badge' : 'Grant Verified badge';
    return (
      <>
        {canManageBadges ? (
          <IconAction label={badgeTitle} icon={ShieldCheck} disabled={!!pendingGrant || earnedBadge} onClick={() => openAction(u, u.verified ? 'verifyRemove' : 'verifyGrant')} />
        ) : null}
        {canManageBadges ? (
          <IconAction
            label={u.archived ? 'Restore the account before changing its status' : suspended ? 'Reactivate' : 'Suspend'}
            icon={suspended ? CheckCircle2 : Ban}
            disabled={u.archived}
            onClick={() => openAction(u, suspended ? 'reactivate' : 'suspend')}
          />
        ) : null}
        {isAdmin ? (
          <IconAction label={u.flagged ? `Remove flag${u.flagReason ? ` \u2014 ${u.flagReason}` : ''}` : 'Flag for review'} icon={Flag} onClick={() => openAction(u, u.flagged ? 'flagClear' : 'flagRaise')} />
        ) : null}
        {!canManageBadges ? null : u.archived
          ? <IconAction label="Restore user" icon={RotateCcw} onClick={() => openAction(u, 'restore')} />
          : <IconAction label="Archive user" icon={Archive} onClick={() => openAction(u, 'archive')} />}
      </>
    );
  };

  const userRow = (u) => (
    <RowCard
      key={u.id}
      id={u.id}
      lead={<span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">{avatarFor(u.name || '?')}</span>}
      title={u.name || 'Unnamed'}
      badges={
        <>
          <Badge status={u.status} />
          {u.verified ? <span className={classNames(CHIP, CHIP_TONE.teal, 'gap-1')}><BadgeCheck className="h-3 w-3" />Verified</span> : null}
          {u.flagged ? <span className={classNames(CHIP, CHIP_TONE.amber, 'gap-1')}><Flag className="h-3 w-3" />Flagged</span> : null}
          {u.badgePending ? <span data-testid="admin-user-pending-badge-pill" className={classNames(CHIP, CHIP_TONE.amber)}>Badge pending</span> : null}
        </>
      }
      meta={<><span>{u.mobile}</span><Dot /><span className="capitalize">{u.role}</span>{u.city ? <><Dot /><span>{u.city}</span></> : null}</>}
      facts={
        <>
          <FactRow label="Activity">
            <Cell>{`${fmtNum(u.listings || 0)} listings`}</Cell>
            <Cell>{u.joinedAt ? `Joined ${timeAgo(u.joinedAt)}` : null}</Cell>
          </FactRow>
          {u.flagged && u.flagReason ? (
            <FactRow label="Flag"><span className="col-span-full text-amber-200">{u.flagReason}</span></FactRow>
          ) : null}
        </>
      }
      primary={isAdmin ? (
        <button type="button" onClick={() => openTimeline(u)} title="View activity" className={BTN.ghost}>
          <Eye className="h-3.5 w-3.5" /> View activity
        </button>
      ) : null}
      icons={actionButtons(u)}
    />
  );

  if (rows === null) return <Loading />;

  const tabs = [
    ...STATUS_TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? null })),
    ...(canManageBadges ? [{ key: 'badges', label: 'Badge approvals', count: counts.badgePending ?? null }] : []),
  ];
  const note = tab === 'badges' ? BADGES_NOTE : STATUS_TABS.find((t) => t.key === tab).note;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${fmtNum(total)} accounts — owners and buyers. Staff are under Team & Access.`}
      />

      <QueueTabs tabs={tabs} active={tab} onChange={setTab} label="User status" idPrefix="users" />
      <QueuePanel
        idPrefix="users"
        active={tab}
        note={note}
        toolbar={tab === 'badges' ? null : (
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Search name or mobile…" label="Search users" />
            <Chips label="Role" options={ROLE_CHIPS} value={role} onChange={setRole} />
            <div className="ml-auto flex items-center gap-2">
              {optionEnabled('users.csvExport') ? (
                <button type="button" onClick={doExport} className={BTN.ghost}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              ) : null}
              <PageNav {...paging} />
            </div>
          </>
        )}
      >
        {tab === 'badges' ? (
          <BadgeApprovals requests={pendingBadgeGrants || []} currentUser={user} onReload={reloadBadges} />
        ) : (
          <RowList isEmpty={!list.length} empty="No users match these filters.">
            {list.map(userRow)}
          </RowList>
        )}
      </QueuePanel>

      <Modal
        open={!!actionModal}
        onClose={closeAction}
        title={actionModal?.copy?.title || 'Confirm action'}
        footer={
          <>
            <button onClick={closeAction} className="dz-btn dz-btn-ghost">Cancel</button>
            <button
              onClick={confirmAction}
              disabled={busy || reasonMissing(actionModal?.copy, noteText)}
              className="dz-btn dz-btn-primary disabled:opacity-50"
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
            {actionError ? <div role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{actionError}</div> : null}
            <label className="mt-3 block">
              <span className="text-xs text-gray-400">
                Reason {actionModal.copy.requiresReason ? <span className="text-amber-300">(required)</span> : '(optional)'}
              </span>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                maxLength={actionModal.copy.minReason ? 300 : undefined}
                placeholder="Add a note for the team… (visible only to admins and staff)"
                className="mt-1 dz-input resize-none text-sm"
              />
            </label>
            {reasonMissing(actionModal.copy, noteText) && (
              <p className="mt-1 text-xs text-amber-300">
                {actionModal.copy.minReason ? `Write at least ${actionModal.copy.minReason} characters.` : 'A reason is required for this action.'}
              </p>
            )}
          </>
        )}
      </Modal>

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
                  className="dz-input resize-none text-sm"
                />
                <button
                  type="button"
                  onClick={submitUserNote}
                  disabled={savingNote || !userNoteDraft.trim()}
                  className="dz-btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-40"
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
                {timeline.map((entry, i) => {
                  const styles = TIMELINE_STYLES[entry.kind] || { icon: Mail, dot: 'bg-gray-400', color: 'text-gray-300', title: 'Activity' };
                  const Icon = styles.icon;
                  return (
                    <div key={`${entry.kind}-${entry.entityId}-${entry.at}-${i}`} className="relative">
                      <div className={`absolute -left-[25px] top-1 h-3 w-3 rounded-full ${styles.dot}`} />
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
    </div>
  );
}
