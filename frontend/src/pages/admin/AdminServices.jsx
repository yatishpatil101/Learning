import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, ConciergeBell, Download, ExternalLink, Inbox, Loader, Play, Save } from 'lucide-react';
import { listTickets, listUsers, updateTicket, logAudit } from '../../lib/mockApi.js';
import { addTicketNote, statusLabel, TEAMS, TEAM_LABEL } from '../../lib/data/tickets.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';

const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PRIORITY_OPTS = [
  { value: '', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const TEAM_OPTS = [{ value: '', label: 'All teams' }, ...TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] }))];
const MODAL_STATUS_OPTS = STATUS_OPTS.filter((o) => o.value);

function openDays(t) {
  const days = Math.floor((Date.now() - new Date(t.createdAt + 'T00:00:00').getTime()) / 86400000);
  return Number.isNaN(days) ? null : days;
}

function AgeChip({ ticket }) {
  if (ticket.status === 'done' || ticket.status === 'cancelled') return null;
  const days = openDays(ticket);
  if (days === null) return null;
  const tone = days >= 5 ? 'bg-red-500/15 text-red-300 border-red-400/30' : days >= 2 ? 'bg-amber-500/15 text-amber-300 border-amber-400/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30';
  const label = days <= 0 ? 'today' : days + 'd open';
  return (
    <div className={classNames('mt-1 inline-flex w-max items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', tone)} title={`Open for ${days < 0 ? 0 : days} day(s)`}>
      <Clock className="h-3 w-3" />
      {label}
    </div>
  );
}

export default function AdminServices() {
  const { toast } = useToast();
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tickets, setTickets] = useState(null);
  const [users, setUsers] = useState([]);

  const [q, setQ] = useState('');
  const [fTeam, setFTeam] = useState('');
  const [fStat, setFStat] = useState('');
  const [fPrio, setFPrio] = useState('');

  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ assignedTo: '', status: 'new', note: '' });

  const reload = useCallback(async () => {
    const t = await listTickets();
    setTickets(t);
    return t;
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listTickets(), listUsers()]).then(([t, u]) => {
      if (!alive) return;
      setTickets(t);
      setUsers(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  const openTicket = useCallback((t) => {
    setOpenId(t.id);
    setForm({ assignedTo: t.assignedTo || '', status: t.status, note: '' });
  }, []);

  // Deep-link: ?open=<id> auto-opens that ticket's modal — once per mount so it
  // doesn't re-open after the admin closes/saves while the URL param clears async.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!tickets || deepLinkHandled.current) return;
    const tid = searchParams.get('open');
    if (!tid) return;
    deepLinkHandled.current = true;
    const t = tickets.find((x) => x.id === tid);
    if (t) openTicket(t);
  }, [tickets, searchParams, openTicket]);

  const kpis = useMemo(() => {
    const T = tickets || [];
    return {
      nw: T.filter((t) => t.status === 'new').length,
      ip: T.filter((t) => t.status === 'in_progress').length,
      dn: T.filter((t) => t.status === 'done').length,
      total: T.length,
    };
  }, [tickets]);

  const rows = useMemo(() => {
    const T = tickets || [];
    const query = q.toLowerCase();
    return T.filter((t) => {
      return (
        (!fTeam || t.team === fTeam) &&
        (!fStat || t.status === fStat) &&
        (!fPrio || t.priority === fPrio) &&
        (!query || (t.id + ' ' + t.service + ' ' + t.customer + ' ' + (t.detail || '') + ' ' + (t.mobile || '')).toLowerCase().includes(query))
      );
    });
  }, [tickets, q, fTeam, fStat, fPrio]);

  const teamStaff = useCallback((team) => users.filter((u) => u.role === 'staff' && u.team === team), [users]);

  const doExport = () => {
    exportCsv(
      'punenest-service-requests.csv',
      ['ID', 'Service', 'Team', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assigned', 'Status', 'Created'],
      rows.map((t) => [t.id, t.service, TEAM_LABEL[t.team] || t.team, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.status, t.createdAt]),
    );
  };

  const startTicket = async (t) => {
    const assignedTo = t.assignedTo || teamStaff(t.team)[0]?.name || null;
    await updateTicket(t.id, { status: 'in_progress', assignedTo });
    logAudit('Service request', 'Started ' + t.id + ' (' + t.service + ')');
    await reload();
    toast('Marked in progress');
  };

  const resolveTicket = async (t) => {
    await updateTicket(t.id, { status: 'done' });
    logAudit('Service request', 'Resolved ' + t.id + ' (' + t.service + ')');
    await reload();
    toast('Request resolved');
  };

  const active = (tickets || []).find((t) => t.id === openId) || null;

  // Clear any ?open= deep-link param so the modal doesn't re-open after it closes.
  const clearOpenParam = () => {
    if (searchParams.get('open')) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  };

  const saveTicket = async () => {
    if (!active) return;
    const assignedTo = form.assignedTo || null;
    await updateTicket(active.id, { assignedTo, status: form.status });
    const note = form.note.trim();
    if (note) addTicketNote(active.id, note, 'Admin');
    logAudit('Service request', 'Updated ' + active.id + ' → ' + form.status + (form.assignedTo ? ', assigned ' + form.assignedTo : ''));
    setOpenId(null);
    clearOpenParam();
    await reload();
    toast('Request updated');
  };

  const closeModal = () => {
    setOpenId(null);
    clearOpenParam();
  };

  if (!tickets || flagsLoading) return <Loading />;

  if (!optionEnabled('services.enabled')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-gray-500 text-sm">Services module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </div>
    );
  }

  const rowActions = (t) => (
    <>
      {t.status === 'new' ? (
        <button onClick={() => startTicket(t)} className="pn-btn pn-btn-primary px-2.5 py-1 text-xs">
          <Play className="h-3.5 w-3.5" /> Start
        </button>
      ) : null}
      {t.status === 'in_progress' ? (
        <button onClick={() => resolveTicket(t)} className="pn-btn pn-btn-primary px-2.5 py-1 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
        </button>
      ) : null}
      <button onClick={() => openTicket(t)} className="pn-btn pn-btn-ghost px-2.5 py-1 text-xs">
        <ExternalLink className="h-3.5 w-3.5" /> Open
      </button>
    </>
  );

  const COLS = [
    { key: 'id', header: 'ID', className: 'text-gray-400', render: (t) => t.id },
    { key: 'service', header: 'Service', className: 'font-semibold', render: (t) => t.service },
    {
      key: 'customer',
      header: 'Customer',
      render: (t) => (
        <div>
          <div>{t.customer}</div>
          <div className="text-xs text-gray-500">{t.mobile}</div>
        </div>
      ),
    },
    { key: 'detail', header: 'Detail', className: 'text-gray-400', render: (t) => t.detail },
    ...(optionEnabled('services.priority') ? [{ key: 'priority', header: 'Priority', render: (t) => <Badge status={t.priority} /> }] : []),
    { key: 'assignedTo', header: 'Assigned', render: (t) => (t.assignedTo ? t.assignedTo : <span className="text-gray-500">—</span>) },
    ...(optionEnabled('services.teamRouting') ? [{
      key: 'team',
      header: 'Team',
      render: (t) => <span className="text-sm">{TEAM_LABEL[t.team] || t.team}</span>,
    }] : []),
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <div>
          <Badge status={t.status} />
          <AgeChip ticket={t} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (t) => (
        <div className="flex items-center gap-2">
          {rowActions(t)}
        </div>
      ),
    },
  ];

  const serviceCard = (t) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{t.service}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {t.id}
            {optionEnabled('services.teamRouting') ? <> · {TEAM_LABEL[t.team] || t.team}</> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Badge status={t.status} />
          <AgeChip ticket={t} />
        </div>
      </div>
      <div className="mt-2 text-sm text-gray-300">
        {t.customer} <span className="text-gray-500">· {t.mobile}</span>
      </div>
      {t.detail ? <div className="mt-1 text-xs text-gray-400">{t.detail}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {optionEnabled('services.priority') ? <Badge status={t.priority} /> : null}
        <span className="text-gray-400">Assigned: <span className="text-gray-200">{t.assignedTo || 'Unassigned'}</span></span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        {rowActions(t)}
      </div>
    </div>
  );

  const staffOpts = active
    ? [{ value: '', label: '— Unassigned —' }, ...teamStaff(active.team).map((s) => ({ value: s.name, label: s.name }))]
    : [{ value: '', label: '— Unassigned —' }];

  const kv = active
    ? [
        ['Request ID', active.id],
        ['Service', active.service],
        ['Team', TEAM_LABEL[active.team] || active.team],
        ['Status', statusLabel(active.status)],
        ['Priority', statusLabel(active.priority)],
        ['Value', fmtINR(active.value || 0)],
        ['Customer', active.customer],
        ['Mobile', active.mobile],
        ['Created', active.createdAt],
        ['Assigned to', active.assignedTo || 'Unassigned'],
        ['Detail', active.detail || '—', true],
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Service Requests"
        subtitle="Route, assign and resolve customer service requests"
        actions={
          <button onClick={doExport} className="pn-btn pn-btn-ghost">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Stat label="New requests" value={fmtNum(kpis.nw)} icon={Inbox} />
        <Stat label="In Progress requests" value={fmtNum(kpis.ip)} icon={Loader} />
        <Stat label="Resolved requests" value={fmtNum(kpis.dn)} icon={CheckCircle2} />
        <Stat label="Total requests" value={fmtNum(kpis.total)} icon={ConciergeBell} />
      </div>

      <div className="pn-card mb-4 flex flex-wrap items-center gap-3 p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, customer, detail…" className="pn-input w-full sm:max-w-[240px]" />
        {optionEnabled('services.teamRouting') && <Select value={fTeam} onChange={setFTeam} options={TEAM_OPTS} ariaLabel="Filter by team" className="max-w-[200px]" />}
        <Select value={fStat} onChange={setFStat} options={STATUS_OPTS} ariaLabel="Filter by status" className="max-w-[160px]" />
        {optionEnabled('services.priority') && <Select value={fPrio} onChange={setFPrio} options={PRIORITY_OPTS} ariaLabel="Filter by priority" className="max-w-[150px]" />}
        <span className="ml-auto text-sm text-gray-400">
          {rows.length} of {tickets.length} requests
        </span>
      </div>

      <Table columns={COLS} rows={rows} pageSize={10} label="requests" empty="No requests match" mobileCard={serviceCard} />

      <Modal
        open={!!active}
        onClose={closeModal}
        title={active ? 'Request ' + active.id : ''}
        size="lg"
        footer={
          <>
            <button onClick={closeModal} className="pn-btn pn-btn-ghost">
              Close
            </button>
            <button onClick={saveTicket} className="pn-btn pn-btn-primary">
              <Save className="h-4 w-4" /> Save
            </button>
          </>
        }
      >
        {active ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <div className="text-lg font-bold">{active.service}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge status={active.status} />
                  {optionEnabled('services.priority') && <Badge status={active.priority} />}
                  {optionEnabled('services.teamRouting') && (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-gray-300">
                      {TEAM_LABEL[active.team] || active.team}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  {active.customer} · {active.mobile}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold">{fmtINR(active.value || 0)}</div>
                <div className="text-xs text-gray-500">est. value</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-gray-300">Request details</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {kv.map(([k, v, full]) => (
                  <div key={k} className={classNames('rounded-lg border border-white/5 bg-white/5 p-3', full && 'sm:col-span-2')}>
                    <div className="text-xs text-gray-500">{k}</div>
                    <div className="mt-0.5 text-sm">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-gray-300">Assignment &amp; status</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {optionEnabled('services.staffAssignment') && (
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Assign to</label>
                    <Select value={form.assignedTo} onChange={(v) => setForm((f) => ({ ...f, assignedTo: v }))} options={staffOpts} ariaLabel="Assign to" />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Status</label>
                  <Select value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} options={MODAL_STATUS_OPTS} ariaLabel="Status" />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-gray-300">Activity</div>
              {active.notes && active.notes.length ? (
                <div className="space-y-2">
                  {active.notes.map((n, i) => (
                    <div key={i} className="border-t border-white/10 pt-2">
                      <div className="text-xs text-gray-500">
                        {n.by} · {n.at}
                      </div>
                      <div className="text-sm text-gray-300">{n.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No notes yet.</div>
              )}
              <textarea
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                rows={2}
                placeholder="Add an internal note…"
                className="pn-input mt-3 w-full"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
