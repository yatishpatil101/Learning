import { useEffect, useMemo, useState } from 'react';
import { Archive, BadgeCheck, Ban, Building2, CalendarCheck, CheckCircle2, ConciergeBell, Download, Eye, Flag, Mail, MessageSquare, RotateCcw, ShieldCheck, UserPlus } from 'lucide-react';
import { listUsers, updateUser, logAudit, archiveRecord, restoreRecord, getUserTimeline } from '../../lib/mockApi.js';
import { fmtNum, classNames, timeAgo, avatarFor } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Loading from '../../components/ui/Loading.jsx';
import InternalNote, { submitNote } from '../../components/ui/InternalNote.jsx';
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

export default function AdminUsers() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [all, setAll] = useState(null);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [actionModal, setActionModal] = useState(null); // { user, type, label }
  const [noteText, setNoteText] = useState('');
  const [timelineUser, setTimelineUser] = useState(null); // user whose timeline is open
  const [timeline, setTimeline] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null); // { type, label, action }

  useEffect(() => {
    let alive = true;
    listUsers(undefined, { includeArchived: true }).then((u) => alive && setAll(u));
    return () => {
      alive = false;
    };
  }, []);

  const patch = (rec) => rec && setAll((prev) => prev.map((u) => (u.id === rec.id ? rec : u)));

  const openAction = (user, type, label) => { setActionModal({ user, type, label }); setNoteText(''); };
  const closeAction = () => setActionModal(null);
  const openTimeline = (user) => { if (!optionEnabled('users.timeline')) return; setTimelineUser(user); setTimeline(getUserTimeline(user.id)); };
  const closeTimeline = () => setTimelineUser(null);

  // Selection & bulk actions
  const toggleSelect = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAllVisible = (checked) => setSelected(checked ? new Set(rows.map((u) => u.id)) : new Set());

  const runBulkVerify = async () => {
    const ids = [...selected];
    for (const id of ids) {
      const rec = await updateUser(id, { verified: true });
      patch(rec);
      submitNote('user', id, '', 'Verified badge granted (bulk)');
    }
    logAudit('User', `Granted Verified badge to ${ids.length} users`);
    toast(`Verified badge granted to ${ids.length} user(s)`, 'success');
    setSelected(new Set());
  };

  const runBulkSuspend = async () => {
    const ids = [...selected];
    for (const id of ids) {
      const rec = await updateUser(id, { status: 'suspended' });
      patch(rec);
      submitNote('user', id, '', 'Bulk suspended');
    }
    logAudit('User', `Bulk suspended ${ids.length} users`);
    toast(`${ids.length} user(s) suspended`, 'warning');
    setSelected(new Set());
  };

  const runBulkArchive = async () => {
    const ids = [...selected];
    for (const id of ids) {
      archiveRecord('users', id, 'Bulk archive');
      submitNote('user', id, '', 'Bulk archived');
      patch({ ...(all.find((u) => u.id === id) || {}), archived: true });
    }
    logAudit('User', `Bulk archived ${ids.length} users`);
    toast(`${ids.length} user(s) archived`, 'info');
    setSelected(new Set());
  };

  const bulkVerify = () => setBulkConfirm({ type: 'verify', label: `Grant Verified badge to ${selected.size} user(s)?`, action: runBulkVerify });
  const bulkSuspend = () => setBulkConfirm({ type: 'suspend', label: `Suspend ${selected.size} user(s)?`, action: runBulkSuspend });
  const bulkArchive = () => setBulkConfirm({ type: 'archive', label: `Archive ${selected.size} user(s)?`, action: runBulkArchive });

  const confirmAction = async () => {
    const { user: u, type } = actionModal;
    switch (type) {
      case 'suspend': {
        const next = u.status === 'suspended' ? 'active' : 'suspended';
        patch(await updateUser(u.id, { status: next }));
        submitNote('user', u.id, noteText, next === 'active' ? 'Reactivated' : 'Suspended');
        logAudit('User', `${next === 'active' ? 'Reactivated' : 'Suspended'} ${u.name} (${u.id})`);
        toast(next === 'active' ? 'User reactivated' : 'User suspended', next === 'active' ? 'success' : 'warning');
        break;
      }
      case 'verify': {
        const rec = await updateUser(u.id, { verified: !u.verified });
        patch(rec);
        submitNote('user', u.id, noteText, rec.verified ? 'Verified badge granted' : 'Verified badge removed');
        logAudit('User', `${rec.verified ? 'Granted Verified badge to' : 'Removed Verified badge from'} ${u.name} (${u.id})`);
        toast(rec.verified ? 'Verified badge granted' : 'Verified badge removed');
        break;
      }
      case 'flag': {
        const rec = await updateUser(u.id, { flagged: !u.flagged });
        patch(rec);
        submitNote('user', u.id, noteText, rec.flagged ? 'Flagged' : 'Unflagged');
        logAudit('User', `${rec.flagged ? 'Flagged' : 'Unflagged'} ${u.name} (${u.id})`);
        toast(rec.flagged ? 'User flagged for review' : 'Flag removed');
        break;
      }
      case 'archive': {
        archiveRecord('users', u.id, 'Archived by admin');
        submitNote('user', u.id, noteText, 'Archived');
        logAudit('User', `Archived ${u.name} (${u.id})`);
        patch({ ...u, archived: true });
        toast('User archived');
        break;
      }
      case 'restore': {
        restoreRecord('users', u.id, 'active');
        submitNote('user', u.id, noteText, 'Restored');
        logAudit('User', `Restored ${u.name} (${u.id})`);
        patch({ ...u, archived: false, status: 'active' });
        toast('User restored', 'success');
        break;
      }
    }
    closeAction();
  };

  const rows = useMemo(() => {
    let list = all || [];
    if (role) list = list.filter((u) => u.role === role);
    if (status === 'archived') {
      list = list.filter((u) => u.archived);
    } else {
      list = list.filter((u) => !u.archived);
      if (status) list = list.filter((u) => u.status === status);
    }
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((u) => (u.name + u.mobile + u.id).toLowerCase().includes(n));
    }
    return list;
  }, [all, role, status, q]);

  // Clear selection when filters change to prevent acting on invisible rows
  useEffect(() => { setSelected(new Set()); }, [role, status, q]);

  if (!all) return <Loading />;

  const actionButtons = (u) => (
    <>
      {optionEnabled('users.timeline') && (
        <button onClick={() => openTimeline(u)} title="View activity" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-indigo-500/15 hover:text-indigo-300 hover:border-indigo-400/30">
          <Eye className="h-4 w-4" />
        </button>
      )}
      <button onClick={() => openAction(u, 'verify', u.verified ? 'Remove Verified badge' : 'Grant Verified badge')} title={u.verified ? 'Remove Verified badge' : 'Grant Verified badge'} className={classNames('rounded-lg border p-1.5', u.verified ? 'border-brand-teal/40 bg-brand-teal/15 text-brand-teal' : 'border-white/10 text-gray-400 hover:bg-white/5')}>
        <ShieldCheck className="h-4 w-4" />
      </button>
      <button onClick={() => openAction(u, 'suspend', u.status === 'suspended' ? 'Reactivate user' : 'Suspend user')} title={u.status === 'suspended' ? 'Reactivate' : 'Suspend'} className={classNames('rounded-lg border p-1.5', u.status === 'suspended' ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' : 'border-red-400/30 bg-red-500/15 text-red-300')}>
        {u.status === 'suspended' ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      </button>
      <button onClick={() => openAction(u, 'flag', u.flagged ? 'Remove flag' : 'Flag user for review')} title={u.flagged ? 'Remove flag' : 'Flag for review'} className={classNames('rounded-lg border p-1.5', u.flagged ? 'border-amber-400/30 bg-amber-500/15 text-amber-300' : 'border-white/10 text-gray-400 hover:bg-white/5')}>
        <Flag className="h-4 w-4" />
      </button>
      {u.archived ? (
        <button onClick={() => openAction(u, 'restore', 'Restore user')} title="Restore user" className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 p-1.5 text-emerald-300">
          <RotateCcw className="h-4 w-4" />
        </button>
      ) : (
        <button onClick={() => openAction(u, 'archive', 'Archive user')} title="Archive user" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-400/30">
          <Archive className="h-4 w-4" />
        </button>
      )}
    </>
  );

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <div>
          <div className="flex items-center gap-1.5 font-semibold">
            {u.name}
            {u.verified ? <BadgeCheck className="h-4 w-4 text-brand-teal" /> : null}
          </div>
          <div className="text-xs text-gray-400">{u.mobile} · {u.id}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <span className="capitalize">{u.role}</span> },
    { key: 'city', header: 'City' },
    { key: 'listings', header: 'Listings', render: (u) => fmtNum(u.listings || 0) },
    { key: 'joinedAt', header: 'Joined' },
    { key: 'status', header: 'Status', render: (u) => u.archived ? <Badge status="archived">Archived</Badge> : <Badge status={u.status} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right whitespace-nowrap',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          {actionButtons(u)}
        </div>
      ),
    },
  ];

  const doExport = () =>
    exportCsv(
      'punenest-users.csv',
      ['ID', 'Name', 'Mobile', 'Role', 'City', 'Listings', 'Joined', 'Verified', 'Status'],
      rows.map((u) => [u.id, u.name, u.mobile, u.role, u.city, u.listings || 0, u.joinedAt, u.verified ? 'Yes' : 'No', u.archived ? 'Archived' : u.status]),
    );

  const bulkOps = optionEnabled('users.bulkOps');
  const userCard = (u) => (
    <div className={classNames('pn-card p-3.5', bulkOps && selected.has(u.id) && 'ring-1 ring-teal-500/40')}>
      <div className="flex items-start gap-3">
        {bulkOps && (
          <input
            type="checkbox"
            checked={selected.has(u.id)}
            onChange={() => toggleSelect(u.id)}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-teal-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{u.name}</span>
            {u.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-teal" /> : null}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">{u.mobile} · {u.id}</div>
        </div>
        <div className="shrink-0">{u.archived ? <Badge status="archived">Archived</Badge> : <Badge status={u.status} />}</div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span className="capitalize text-gray-300">{u.role}</span>
        <span className="text-gray-600">·</span>
        <span>{u.city}</span>
        <span className="text-gray-600">·</span>
        <span>{fmtNum(u.listings || 0)} listings</span>
        <span className="text-gray-600">·</span>
        <span>Joined {u.joinedAt}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
        {actionButtons(u)}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={rows.length === all.length ? `${fmtNum(all.length)} accounts — owners, buyers and staff.` : `${fmtNum(rows.length)} of ${fmtNum(all.length)} accounts`}
        actions={
          optionEnabled('users.csvExport') && (
            <button onClick={doExport} className="pn-btn pn-btn-ghost">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, ID…" className="pn-input sm:w-64" />
        <Select value={role} onChange={setRole} options={ROLE_OPTS} className="sm:w-40" ariaLabel="Filter by role" />
        <Select value={status} onChange={setStatus} options={STATUS_OPTS} className="sm:w-40" ariaLabel="Filter by status" />
      </div>

      {/* Bulk action bar */}
      {optionEnabled('users.bulkOps') && selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/5 px-4 py-3">
          <span className="text-sm font-semibold text-teal-300">{selected.size} selected</span>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button onClick={bulkVerify} className="pn-btn pn-btn-ghost text-sm inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Grant badge
            </button>
            <button onClick={bulkSuspend} className="pn-btn pn-btn-ghost text-sm inline-flex items-center gap-1.5 text-rose-300 hover:text-rose-200">
              <Ban className="h-3.5 w-3.5" /> Suspend all
            </button>
            <button onClick={bulkArchive} className="pn-btn pn-btn-ghost text-sm inline-flex items-center gap-1.5 text-amber-300 hover:text-amber-200">
              <Archive className="h-3.5 w-3.5" /> Archive all
            </button>
            <button onClick={() => setSelected(new Set())} className="pn-btn pn-btn-ghost text-sm text-gray-400">
              Clear
            </button>
          </div>
        </div>
      )}

      <Table columns={columns} rows={rows} pageSize={10} label="users" empty="No users match these filters." selectable={optionEnabled('users.bulkOps')} selected={selected} onSelect={toggleSelect} onSelectAll={selectAllVisible} mobileCard={userCard} />

      {/* Action confirmation modal with internal note */}
      <Modal
        open={!!actionModal}
        onClose={closeAction}
        title={actionModal?.label || 'Confirm action'}
        footer={
          <>
            <button onClick={closeAction} className="pn-btn pn-btn-ghost">Cancel</button>
            <button onClick={confirmAction} className="pn-btn pn-btn-primary">Confirm</button>
          </>
        }
      >
        {actionModal && (
          <>
            <p className="text-sm text-gray-400">
              {actionModal.label} <span className="font-medium text-gray-200">{actionModal.user.name}</span> ({actionModal.user.id})?
            </p>
            <InternalNote entityType="user" entityId={actionModal.user.id} value={noteText} onChange={setNoteText} showHistory />
          </>
        )}
      </Modal>

      {/* Bulk action confirmation modal */}
      <Modal
        open={!!bulkConfirm}
        onClose={() => setBulkConfirm(null)}
        title={bulkConfirm?.label || 'Confirm'}
        size="sm"
        footer={
          <>
            <button onClick={() => setBulkConfirm(null)} className="pn-btn pn-btn-ghost">Cancel</button>
            <button onClick={() => { bulkConfirm?.action(); setBulkConfirm(null); }} className="pn-btn pn-btn-primary">Confirm</button>
          </>
        }
      >
        <p className="text-sm text-gray-400">This action will be applied to <span className="font-semibold text-gray-200">{selected.size} selected user(s)</span>. It can be reversed individually from the user row.</p>
      </Modal>

      {/* User Activity Timeline Modal */}
      {optionEnabled('users.timeline') && <Modal open={!!timelineUser} onClose={closeTimeline} title={timelineUser ? `Activity — ${timelineUser.name}` : ''} size="lg">
        {timelineUser && (
          <div>
            {/* User summary header */}
            <div className="mb-4 flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/15 text-indigo-300 text-lg font-bold">
                {avatarFor(timelineUser.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{timelineUser.name}</span>
                  {timelineUser.verified && <BadgeCheck className="h-4 w-4 text-brand-teal" />}
                  <Badge status={timelineUser.status} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{timelineUser.mobile} · {timelineUser.role} · Joined {timelineUser.joinedAt}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{timeline.length}</div>
                <div className="text-xs text-gray-500">activities</div>
              </div>
            </div>

            {/* Timeline */}
            {timeline.length > 0 ? (
              <div className="relative pl-6 border-l border-white/10 max-h-[60vh] overflow-y-auto space-y-4">
                {timeline.map((entry) => {
                  const styles = {
                    account: { icon: UserPlus, dot: 'bg-emerald-400', color: 'text-emerald-300' },
                    enquiry: { icon: Mail, dot: 'bg-teal-400', color: 'text-teal-300' },
                    visit: { icon: CalendarCheck, dot: 'bg-sky-400', color: 'text-sky-300' },
                    service: { icon: ConciergeBell, dot: 'bg-amber-400', color: 'text-amber-300' },
                    listing: { icon: Building2, dot: 'bg-indigo-400', color: 'text-indigo-300' },
                    note: { icon: MessageSquare, dot: 'bg-gray-400', color: 'text-gray-300' },
                  }[entry.type] || { icon: Mail, dot: 'bg-gray-400', color: 'text-gray-300' };
                  const Icon = styles.icon;
                  return (
                    <div key={entry.id} className="relative">
                      <div className={`absolute -left-[25px] top-1 h-3 w-3 rounded-full border-2 border-ink ${styles.dot}`} />
                      <div className="flex items-start gap-3">
                        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 ${styles.color}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${styles.color}`}>{entry.action}</span>
                            {entry.meta?.status && <Badge status={entry.meta.status} />}
                          </div>
                          {entry.detail && <p className="text-sm text-gray-400 mt-0.5 truncate">{entry.detail}</p>}
                          <div className="text-[11px] text-gray-500 mt-1">
                            {timeAgo(entry.at)}
                            {entry.meta?.by && <span> · {entry.meta.by}</span>}
                            {entry.meta?.value && <span> · ₹{fmtNum(entry.meta.value)}</span>}
                          </div>
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
      </Modal>}
    </div>
  );
}
