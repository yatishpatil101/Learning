import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { listTickets, updateTicket, logAudit } from '../../lib/mockApi.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';

const STATUS_OPTS = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];
const PRIORITY = { high: 'text-red-300', medium: 'text-amber-300', low: 'text-gray-400' };
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminSupport() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [all, setAll] = useState(null);
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    listTickets().then((t) => alive && setAll(t));
    return () => {
      alive = false;
    };
  }, []);

  const patch = (rec) => {
    if (!rec) return;
    setAll((prev) => prev.map((t) => (t.id === rec.id ? rec : t)));
    setDetail((d) => (d && d.id === rec.id ? rec : d));
  };

  const setTicketStatus = async (id, next) => {
    patch(await updateTicket(id, { status: next }));
    logAudit('Support ticket', `${id} status → ${next}`);
    toast('Ticket updated', 'success');
  };
  const assign = async (id, name) => patch(await updateTicket(id, { assignedTo: name }));
  const addNote = async () => {
    if (!note.trim() || !detail) return;
    const notes = [...(detail.notes || []), { at: today(), by: user?.name || 'Admin', text: note.trim() }];
    patch(await updateTicket(detail.id, { notes }));
    setNote('');
    toast('Note added');
  };

  const teams = useMemo(() => [...new Set((all || []).map((t) => t.team))], [all]);
  const rows = useMemo(() => {
    let list = all || [];
    if (team) list = list.filter((t) => t.team === team);
    if (status) list = list.filter((t) => t.status === status);
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((t) => (t.customer + t.mobile + t.id + (t.service || '')).toLowerCase().includes(n));
    }
    return list;
  }, [all, team, status, q]);

  if (!all) return <Loading />;

  const columns = [
    {
      key: 'customer',
      header: 'Ticket',
      render: (t) => (
        <div>
          <div className="font-semibold">{t.customer}</div>
          <div className="text-xs text-gray-400">{t.id} · {t.service}</div>
        </div>
      ),
    },
    { key: 'team', header: 'Team', render: (t) => <span className="capitalize">{t.team}</span> },
    { key: 'priority', header: 'Priority', render: (t) => <span className={classNames('font-medium capitalize', PRIORITY[t.priority])}>{t.priority}</span> },
    { key: 'assignedTo', header: 'Assignee', render: (t) => t.assignedTo || <span className="text-gray-500">Unassigned</span> },
    { key: 'value', header: 'Value', render: (t) => (t.value ? fmtINR(t.value) : '—') },
    { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
  ];

  /* Stacked-card fallback below `sm` (see Table.jsx). The whole row opens the detail
     modal, matching onRowClick on the table. */
  const ticketCard = (t) => (
    <button type="button" onClick={() => { setDetail(t); setNote(''); }} className="pn-card block w-full p-3.5 text-left">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.customer}</div>
          <div className="mt-0.5 text-xs text-gray-400">{t.id} · {t.service}</div>
        </div>
        <div className="shrink-0"><Badge status={t.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span className={classNames('font-medium capitalize', PRIORITY[t.priority])}>{t.priority}</span>
        <span className="text-gray-600">·</span>
        <span className="capitalize">{t.team}</span>
        <span className="text-gray-600">·</span>
        <span>{t.assignedTo || 'Unassigned'}</span>
        {t.value ? (<><span className="text-gray-600">·</span><span>{fmtINR(t.value)}</span></>) : null}
      </div>
    </button>
  );

  const doExport = () =>
    exportCsv(
      'punenest-tickets.csv',
      ['ID', 'Team', 'Service', 'Customer', 'Mobile', 'Priority', 'Assignee', 'Value', 'Status', 'Created'],
      rows.map((t) => [t.id, t.team, t.service, t.customer, t.mobile, t.priority, t.assignedTo || '', t.value || 0, t.status, t.createdAt]),
    );

  return (
    <div>
      <PageHeader
        title="Support"
        subtitle="Cross-team oversight of every service request and ticket."
        actions={
          <button onClick={doExport} className="pn-btn pn-btn-ghost">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, ID, service…" className="pn-input sm:w-64" />
        <Select value={team} onChange={setTeam} options={[{ value: '', label: 'All teams' }, ...teams.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]} className="sm:w-40" ariaLabel="Filter by team" />
        <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...STATUS_OPTS]} className="sm:w-44" ariaLabel="Filter by status" />
      </div>

      <Table columns={columns} rows={rows} onRowClick={(t) => { setDetail(t); setNote(''); }} pageSize={10} label="tickets" empty="No tickets match these filters." mobileCard={ticketCard} />

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.id} · ${detail.service}` : ''} size="lg">
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={detail.status} />
              <span className={classNames('text-sm font-medium capitalize', PRIORITY[detail.priority])}>{detail.priority} priority</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['Customer', detail.customer],
                ['Mobile', detail.mobile],
                ['Team', detail.team],
                ['Value', detail.value ? fmtINR(detail.value) : '—'],
                ['Created', detail.createdAt],
                ['Detail', detail.detail || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-white/5 py-1">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className="text-right font-medium capitalize">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-gray-400">Status</span>
                <Select value={detail.status} onChange={(v) => setTicketStatus(detail.id, v)} options={STATUS_OPTS} ariaLabel="Set status" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-gray-400">Assignee</span>
                <input
                  defaultValue={detail.assignedTo || ''}
                  onBlur={(e) => assign(detail.id, e.target.value.trim() || null)}
                  placeholder="Unassigned"
                  className="pn-input"
                />
              </label>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Activity</h4>
              <ul className="space-y-2">
                {(detail.notes || []).length === 0 ? (
                  <li className="text-sm text-gray-500">No notes yet.</li>
                ) : (
                  detail.notes.map((n, i) => (
                    <li key={i} className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm">
                      <div className="text-gray-300">{n.text}</div>
                      <div className="mt-1 text-xs text-gray-500">{n.by} · {n.at}</div>
                    </li>
                  ))
                )}
              </ul>
              <div className="mt-3 flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Add a note…" className="pn-input flex-1" />
                <button onClick={addNote} className="pn-btn pn-btn-primary">Add</button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
