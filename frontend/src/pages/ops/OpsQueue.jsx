import { useEffect, useMemo, useState } from 'react';
import { Check, Download, ExternalLink, Hand } from 'lucide-react';
import { listTickets, updateTicket } from '../../lib/mockApi.js';
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

/* Shared queue used by every ops team page. `team` scopes the tickets; when null
   (the all-requests view) admins see everything and staff see their own team. */
export default function OpsQueue({ title, subtitle, team = null }) {
  const { toast } = useToast();
  const { user, role, team: myTeam } = useAuth();
  const [all, setAll] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const meName = user?.name || 'Me';

  // Resolve which team's tickets to load.
  const scope = team || (role === 'admin' ? undefined : myTeam || undefined);

  useEffect(() => {
    let alive = true;
    setAll(null);
    listTickets(scope).then((t) => alive && setAll(t));
    return () => {
      alive = false;
    };
  }, [scope]);

  const patch = (rec) => {
    if (!rec) return;
    setAll((prev) => prev.map((t) => (t.id === rec.id ? rec : t)));
    setDetail((d) => (d && d.id === rec.id ? rec : d));
  };

  const setTicketStatus = async (id, next) => {
    patch(await updateTicket(id, { status: next }));
    toast('Ticket updated', 'success');
  };
  const claim = async (t) => {
    patch(await updateTicket(t.id, { assignedTo: user?.name || 'Me', status: t.status === 'new' ? 'in_progress' : t.status }));
    toast('Assigned to you', 'success');
  };
  const addNote = async () => {
    if (!note.trim() || !detail) return;
    const notes = [...(detail.notes || []), { at: today(), by: user?.name || 'Ops', text: note.trim() }];
    patch(await updateTicket(detail.id, { notes }));
    setNote('');
    toast('Note added');
  };

  const counts = useMemo(() => {
    const list = all || [];
    return {
      total: list.length,
      new: list.filter((t) => t.status === 'new').length,
      progress: list.filter((t) => t.status === 'in_progress').length,
      done: list.filter((t) => t.status === 'done').length,
      mine: list.filter((t) => t.assignedTo === meName).length,
    };
  }, [all, meName]);

  const rows = useMemo(() => {
    let list = all || [];
    if (mineOnly) list = list.filter((t) => t.assignedTo === meName);
    if (status) list = list.filter((t) => t.status === status);
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((t) => (t.customer + t.mobile + t.id + (t.detail || '')).toLowerCase().includes(n));
    }
    return list;
  }, [all, status, q, mineOnly, meName]);

  if (!all) return <Loading />;

  const showTeam = !team && role === 'admin';
  const columns = [
    {
      key: 'customer',
      header: 'Ticket',
      render: (t) => (
        <div>
          <div className="font-semibold">{t.customer}</div>
          <div className="text-xs text-gray-400">{t.id} · {t.mobile}</div>
        </div>
      ),
    },
    ...(showTeam ? [{ key: 'team', header: 'Team', render: (t) => <span className="capitalize">{t.team}</span> }] : []),
    { key: 'detail', header: 'Detail', render: (t) => t.detail || '—' },
    { key: 'priority', header: 'Priority', render: (t) => <span className={classNames('font-medium capitalize', PRIORITY[t.priority])}>{t.priority}</span> },
    { key: 'assignedTo', header: 'Assignee', render: (t) => t.assignedTo || <span className="text-gray-500">Unassigned</span> },
    { key: 'value', header: 'Value', render: (t) => (t.value ? fmtINR(t.value) : '—') },
    { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
    {
      key: '_actions',
      header: 'Actions',
      render: (t) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.status === 'new' ? (
            <button onClick={(e) => { e.stopPropagation(); claim(t); }} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300"><Hand className="h-3 w-3" />Claim</button>
          ) : t.status === 'in_progress' ? (
            <button onClick={(e) => { e.stopPropagation(); setTicketStatus(t.id, 'done'); }} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"><Check className="h-3 w-3" />Resolve</button>
          ) : null}
          <button onClick={(e) => { e.stopPropagation(); setDetail(t); setNote(''); }} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><ExternalLink className="h-3 w-3" />Open</button>
        </div>
      ),
    },
  ];

  /* Ops staff genuinely work this queue from a phone between site visits, so the
     table gets a stacked-card fallback below `sm` (see Table.jsx). Claim/Resolve
     are the two actions that must survive to mobile — they're 44px here. */
  const ticketCard = (t) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.customer}</div>
          <div className="mt-0.5 text-xs text-gray-400">{t.id} · {t.mobile}</div>
        </div>
        <div className="shrink-0"><Badge status={t.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span className={classNames('font-medium capitalize', PRIORITY[t.priority])}>{t.priority}</span>
        {showTeam ? (<><span className="text-gray-600">·</span><span className="capitalize">{t.team}</span></>) : null}
        <span className="text-gray-600">·</span>
        <span>{t.assignedTo || 'Unassigned'}</span>
        {t.value ? (<><span className="text-gray-600">·</span><span>{fmtINR(t.value)}</span></>) : null}
      </div>
      {t.detail ? <div className="mt-2 text-sm text-gray-300">{t.detail}</div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        {t.status === 'new' ? (
          <button onClick={() => claim(t)} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 text-sm text-indigo-300"><Hand className="h-4 w-4" />Claim</button>
        ) : t.status === 'in_progress' ? (
          <button onClick={() => setTicketStatus(t.id, 'done')} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 text-sm text-emerald-300"><Check className="h-4 w-4" />Resolve</button>
        ) : null}
        <button onClick={() => { setDetail(t); setNote(''); }} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm text-gray-300"><ExternalLink className="h-4 w-4" />Open</button>
      </div>
    </div>
  );

  const doExport = () =>
    exportCsv(
      `punenest-${team || 'requests'}.csv`,
      ['ID', 'Team', 'Service', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assignee', 'Value', 'Status', 'Created'],
      rows.map((t) => [t.id, t.team, t.service, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.value || 0, t.status, t.createdAt]),
    );

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <button onClick={doExport} className="pn-btn pn-btn-ghost">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['All', counts.total, ''],
          ['New', counts.new, 'new'],
          ['In progress', counts.progress, 'in_progress'],
          ['Done', counts.done, 'done'],
        ].map(([label, count, key]) => (
          <button
            key={label}
            onClick={() => setStatus(key)}
            className={classNames('pn-card p-4 text-left transition', status === key ? 'border-brand-teal/40 ring-1 ring-brand-teal/30' : 'hover:bg-white/5')}
          >
            <div className="text-2xl font-extrabold">{fmtNum(count)}</div>
            <div className="text-xs text-gray-400">{label}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, ID, detail…" className="pn-input sm:w-72" />
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={classNames('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition', mineOnly ? 'border-brand-teal/40 bg-brand-teal/10 text-brand-teal' : 'border-white/10 text-gray-300 hover:bg-white/5')}
        >
          <Hand className="h-4 w-4" /> Assigned to me <span className="opacity-70">({fmtNum(counts.mine)})</span>
        </button>
      </div>

      {/* pageSize matches AdminSupport, which renders the same `listTickets` data —
          this queue was the only one that never got it, so it rendered every ticket
          at once (measured 1,857 DOM nodes / 34 rows on /ops/requests, and it grows
          with the backlog). Field-ops staff open this on a phone, where a long DOM
          costs both scroll distance and layout time. Table already implements the
          pager, so this is the same one prop every sibling table passes. */}
      <Table columns={columns} rows={rows} onRowClick={(t) => { setDetail(t); setNote(''); }} pageSize={10} label="tickets" empty="No tickets in this queue." mobileCard={ticketCard} />

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
              <div className="flex items-end">
                <button onClick={() => claim(detail)} className="pn-btn pn-btn-ghost w-full">
                  {detail.assignedTo ? `Assigned: ${detail.assignedTo}` : 'Assign to me'}
                </button>
              </div>
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
