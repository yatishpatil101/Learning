import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, ConciergeBell, Download, ExternalLink, Inbox, Loader, Play, Save } from 'lucide-react';
import { addTicketNote, claimTicket, listTicketQueue, setTicketStatus } from '../../services/ticketService.js';
import { listTeamMembers } from '../../services/teamService.js';
import { TEAMS, TEAM_LABEL } from '../../lib/data/tickets.js';
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

/* The server's vocabulary, not the browser's.
   -------------------------------------------
   This list used to read `new / in_progress / done / cancelled`, which was the mock store's own
   invention. `TicketStatuses` on the server has five words and two of them are different ideas:
   `waiting` (we are blocked on the customer) and `closed` (filed without a resolution) are states
   a desk genuinely reaches and the old four could not express, and `cancelled` was never one of
   them. Renaming the labels would not have been enough — `updateTicket(id, { status: 'done' })`
   against `PATCH /tickets/{id}` is a 400, so the words here are the request, not a display detail. */
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
const LABEL = {
  open: 'Open', 'in-progress': 'In Progress', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed',
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};
const label = (v) => LABEL[v] || v || '';
/* `urgent` is in `TicketPriorities` and was missing here, so an urgent ticket was unfilterable. */
const PRIORITY_OPTS = [
  { value: '', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const TEAM_OPTS = [{ value: '', label: 'All teams' }, ...TEAMS.map((t) => ({ value: t, label: TEAM_LABEL[t] }))];
const MODAL_STATUS_OPTS = STATUS_OPTS.filter((o) => o.value);

/* Every count and filter above the table is computed across rows, so a page of the list would make
   them lies — "6 open" taken from page 1 of 4 is not a fact about the desk. Same window, and the
   same reasoning, as `OpsQueue`. */
const WINDOW = 100;

const asDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/**
 * What to call a ticket.
 *
 * `service` is an ops annotation — `TicketCreate` has no component for it on purpose, because a
 * client that could name its own service line would be writing the pipeline report. So it is null
 * on every ticket a customer raised, and `subject` (the words they actually typed, and the only
 * required field on the form) is the name. The board used to render `t.service` alone, which meant
 * a blank primary column and an unsearchable row for precisely the enquiries that came from
 * outside. Falling back is not cosmetic: the search corpus below uses the same value.
 */
const titleOf = (t) => t.service || t.subject || '';

function openDays(t) {
  /* `createdAt` is epoch milliseconds off `ticketMapper.toViewModel`, not the mock store's
     `YYYY-MM-DD`. The old body appended `'T00:00:00'` to it, which on a number yields
     `Invalid Date` and silently hid every age chip on the board. */
  if (!t.createdAt) return null;
  const days = Math.floor((Date.now() - t.createdAt) / 86400000);
  return Number.isNaN(days) ? null : days;
}

function AgeChip({ ticket }) {
  if (ticket.status === 'resolved' || ticket.status === 'closed') return null;
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
  const [staff, setStaff] = useState([]);
  const [loadError, setLoadError] = useState('');

  const [q, setQ] = useState('');
  const [fTeam, setFTeam] = useState('');
  const [fStat, setFStat] = useState('');
  const [fPrio, setFPrio] = useState('');

  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ assigneeId: '', status: 'open', note: '' });

  const reload = useCallback(async () => {
    const res = await listTicketQueue({ size: WINDOW });
    setTickets(res.items);
    return res.items;
  }, []);

  useEffect(() => {
    let alive = true;
    /* Two independent reads, so they go out together. `listTeamMembers` is what makes the assignee
       dropdown possible at all: `TicketUpdate.assigneeId` takes an id, and the board can only turn
       "Priya" into an id if it has the directory. `OpsQueue` has no directory and is therefore
       self-claim only — this console is the one screen that can hand work to a named colleague. */
    Promise.all([
      listTicketQueue({ size: WINDOW }),
      listTeamMembers().catch(() => []),
    ]).then(([res, members]) => {
      if (!alive) return;
      setTickets(res.items);
      setStaff(members);
    }).catch((e) => {
      if (!alive) return;
      /* Not `setTickets([])`. An unread failure rendered as an empty board is how a desk goes home
         early, and a 403 here is information rather than an outage. */
      setTickets([]);
      setLoadError(e?.message || 'The service requests could not be read.');
    });
    return () => {
      alive = false;
    };
  }, []);

  const openTicket = useCallback((t) => {
    setOpenId(t.id);
    setForm({ assigneeId: '', status: t.status, note: '' });
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
      nw: T.filter((t) => t.status === 'open').length,
      ip: T.filter((t) => t.status === 'in-progress').length,
      dn: T.filter((t) => t.status === 'resolved').length,
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
        (!query || (t.id + ' ' + titleOf(t) + ' ' + t.customer + ' ' + (t.detail || '') + ' ' + (t.mobile || '')).toLowerCase().includes(query))
      );
    });
  }, [tickets, q, fTeam, fStat, fPrio]);

  /* Active back-office accounts on this desk. `listTeamMembers` already narrows to `staff`+`admin`,
     so the filter here is the team and whether the account is still live — assigning work to a
     suspended colleague is a silent way to lose a ticket. */
  const teamStaff = useCallback(
    (team) => staff.filter((s) => s.status === 'active' && (s.teams || []).includes(team)),
    [staff],
  );

  const doExport = () => {
    exportCsv(
      'punenest-service-requests.csv',
      ['ID', 'Service', 'Team', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assigned', 'Status', 'Created'],
      rows.map((t) => [t.id, titleOf(t), TEAM_LABEL[t.team] || t.team, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.status, asDate(t.createdAt)]),
    );
  };

  const patch = (rec) => {
    if (!rec) return;
    setTickets((list) => (list || []).map((t) => (t.id === rec.id ? rec : t)));
  };

  /* Claim and move are two calls because they are two decisions, and the server is entitled to
     refuse the transition on its own terms — see `ticketMapper.toClaim`. Assigning first means a
     refused move still leaves the ticket owned by someone, which is the safer half to land. */
  const startTicket = async (t) => {
    try {
      const first = t.assignedTo ? null : teamStaff(t.team)[0];
      if (first) patch(await claimTicket(t.id, first.id));
      patch(await setTicketStatus(t.id, 'in-progress'));
      toast('Marked in progress');
    } catch (e) {
      toast(e?.message || 'That request could not be started.', 'error');
    }
  };

  const resolveTicket = async (t) => {
    try {
      patch(await setTicketStatus(t.id, 'resolved'));
      toast('Request resolved');
    } catch (e) {
      toast(e?.message || 'That request could not be resolved.', 'error');
    }
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
    try {
      /* Three separate calls, in the order that leaves the least damage if one fails. Assignment
         first, because owning a ticket is never the wrong half to land; then the status, which the
         server may refuse; then the note, which is an append the server timestamps itself. The old
         body sent `{ assignedTo, status }` in one PATCH and rewrote the whole `notes` array, so
         whichever of two colleagues saved second erased the other's note. */
      if (form.assigneeId && form.assigneeId !== '__keep__') patch(await claimTicket(active.id, form.assigneeId));
      if (form.status && form.status !== active.status) patch(await setTicketStatus(active.id, form.status));
      const note = form.note.trim();
      if (note) await addTicketNote(active.id, note);
      setOpenId(null);
      clearOpenParam();
      await reload();
      toast('Request updated');
    } catch (e) {
      toast(e?.message || 'That request could not be updated.', 'error');
    }
  };

  const closeModal = () => {
    setOpenId(null);
    clearOpenParam();
  };

  /* Every early return below still renders the page header.
     A console that cannot serve is still that console, and an operator who followed a link or a
     redirect to /admin/services needs to be told where they landed before they are told what is
     wrong. Returning a bare sentence on an unlabelled page reads as a broken route rather than a
     working route with nothing behind it — which is how `consolidation.spec.js` caught this: it
     asserts the /admin/support redirect "lands somewhere real", and the offline branch made it
     land nowhere. */
  const notice = (body) => (
    <div>
      <PageHeader title="Service Requests" subtitle="Route, assign and resolve customer service requests" />
      <div className="flex flex-col items-center justify-center py-20 text-center">{body}</div>
    </div>
  );

  /* A "served by the API, which is not enabled in this build" notice stood here, because `ticket`
     was a live-only domain with no mock provider (D184) and an empty board would have read as "no
     customer has asked for anything". There is no build in which the API is not enabled now. */

  if (!tickets || flagsLoading) return <Loading />;

  if (loadError) {
    return notice(<div className="text-red-300 text-sm">{loadError}</div>);
  }

  if (!optionEnabled('services.enabled')) {
    return notice(
      <>
        <div className="text-gray-500 text-sm">Services module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </>,
    );
  }

  const rowActions = (t) => (
    <>
      {t.status === 'open' ? (
        <button onClick={() => startTicket(t)} className="pn-btn pn-btn-primary px-2.5 py-1 text-xs">
          <Play className="h-3.5 w-3.5" /> Start
        </button>
      ) : null}
      {t.status === 'in-progress' ? (
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
    { key: 'service', header: 'Service', className: 'font-semibold', render: (t) => titleOf(t) },
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
          <div className="truncate font-semibold">{titleOf(t)}</div>
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

  /* Values are user ids, not names. `TicketUpdate.assigneeId` takes an id (S42) — the old board sent
     a display name, which meant two colleagues called Priya were the same person and a rename
     orphaned every ticket they held. The blank option is "leave as it is", not "unassign":
     unassigning has its own sentinel on the server and no control on this screen asks for it. */
  const staffOpts = active
    ? [{ value: '', label: '— Leave unchanged —' }, ...teamStaff(active.team).map((s) => ({ value: s.id, label: s.name }))]
    : [{ value: '', label: '— Leave unchanged —' }];

  const kv = active
    ? [
        ['Request ID', active.id],
        ['Service', titleOf(active)],
        ['Team', TEAM_LABEL[active.team] || active.team],
        ['Status', label(active.status)],
        ['Priority', label(active.priority)],
        ['Value', fmtINR(active.value || 0)],
        ['Customer', active.customer],
        ['Mobile', active.mobile],
        ['Created', asDate(active.createdAt)],
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
        <Stat label="Open requests" value={fmtNum(kpis.nw)} icon={Inbox} />
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
                <div className="text-lg font-bold">{titleOf(active)}</div>
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
                    <Select value={form.assigneeId} onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))} options={staffOpts} ariaLabel="Assign to" />
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
