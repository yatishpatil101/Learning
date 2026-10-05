import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, Download, ExternalLink, Hand, Play, Save } from 'lucide-react';
import { addTicketNote, claimTicket, listTicketQueue, setTicketStatus } from '../../services/ticketService.js';
import { listTeamMembers } from '../../services/teamService.js';
import { TEAM_LABEL as DESK_LABEL } from '../../lib/data/tickets.js';
import { deskFromFunction } from '../../lib/adminModules.js';
import { fmtINR, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, Cell, Chips, ClearFilters, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

/* The server's `TicketStatuses` vocabulary, including `waiting` and `closed`; `PATCH /tickets/{id}` answers 400 to words like `done`. */
const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];
const LABEL = {
  open: 'Open', 'in-progress': 'In Progress', waiting: 'Waiting', resolved: 'Resolved', closed: 'Closed',
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};
const label = (v) => LABEL[v] || v || '';
/* `urgent` is in `TicketPriorities`; omit it here and an urgent ticket is unfilterable. */
const PRIORITY_CHIPS = [
  { value: '', label: 'All' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const MODAL_STATUS_OPTS = STATUS_TABS.filter((s) => s.key !== 'all').map((s) => ({ value: s.key, label: LABEL[s.key] }));
const NOTE = 'Customer tickets for this desk. Claim one to own it, Start when you begin, Resolve when it is done.';

/* Every count and filter here is computed across rows, so a page of the list would make them lies —
   "6 open" taken from page 1 of 4 is not a fact about the desk. */
const WINDOW = 100;
const PAGE_SIZE = 10;

const asDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const memberDesks = (s) => (s.functions || []).map(deskFromFunction).filter(Boolean);
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/* `service` is an ops annotation and null on every ticket a customer raised, so `subject` (the words
   they typed) is the fallback name — and the search corpus below uses the same value. */
const titleOf = (t) => t.service || t.subject || '';

function openDays(t) {
  // `createdAt` is epoch milliseconds; anything else would silently hide every age chip.
  if (!t.createdAt) return null;
  const days = Math.floor((Date.now() - t.createdAt) / 86400000);
  return Number.isNaN(days) ? null : days;
}

function AgeChip({ ticket }) {
  if (ticket.status === 'resolved' || ticket.status === 'closed') return null;
  const days = openDays(ticket);
  if (days === null) return null;
  const tone = days >= 5 ? CHIP_TONE.red : days >= 2 ? CHIP_TONE.amber : CHIP_TONE.green;
  return (
    <span className={classNames(CHIP, 'gap-1', tone)} title={`Open for ${days < 0 ? 0 : days} day(s)`}>
      <Clock className="h-3 w-3" />
      {days <= 0 ? 'today' : days + 'd open'}
    </span>
  );
}

/** A desk's customer tickets. `embedded` renders the board alone, inside a service desk's own tabs. */
export default function AdminServices({ desk, embedded = false, idPrefix = 'queue' }) {
  const { toast } = useToast();
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();
  const { user, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tickets, setTickets] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loadError, setLoadError] = useState('');

  const [q, setQ] = useState('');
  const [fStat, setFStat] = useState('open');
  const [fPrio, setFPrio] = useState('');

  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ assigneeId: '', status: 'open', note: '' });

  const reload = useCallback(async () => {
    const res = await listTicketQueue({ size: WINDOW, team: desk });
    setTickets(res.items);
    return res.items;
  }, [desk]);

  useEffect(() => {
    let alive = true;
    // The directory turns "Priya" into the id `TicketUpdate.assigneeId` takes; without it the board is self-claim only.
    Promise.all([
      listTicketQueue({ size: WINDOW, team: desk }),
      // `GET /users` is refused to desk staff, who can only claim for themselves.
      role === 'staff' ? [] : listTeamMembers().catch(() => []),
    ]).then(([res, members]) => {
      if (!alive) return;
      setTickets(res.items);
      setStaff(members);
    }).catch((e) => {
      if (!alive) return;
      // Not an empty board: an unread failure rendered as "nothing to do" is how a desk goes home early.
      setTickets([]);
      setLoadError(e?.message || 'The service requests could not be read.');
    });
    return () => {
      alive = false;
    };
  }, [desk, role]);

  const title = DESK_LABEL[desk] || desk;

  const openTicket = useCallback((t) => {
    setOpenId(t.id);
    setForm({ assigneeId: '', status: t.status, note: '' });
  }, []);

  // ?open=<id> opens that ticket once per mount, so it does not re-open while the param clears.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!tickets || deepLinkHandled.current) return;
    const tid = searchParams.get('open');
    if (!tid) return;
    deepLinkHandled.current = true;
    const t = tickets.find((x) => x.id === tid);
    if (!t) return;
    setFStat(t.status);
    openTicket(t);
  }, [tickets, searchParams, openTicket]);

  const counts = useMemo(() => {
    const T = tickets || [];
    const c = { all: T.length };
    for (const s of STATUS_TABS) if (s.key !== 'all') c[s.key] = T.filter((t) => t.status === s.key).length;
    return c;
  }, [tickets]);

  const rows = useMemo(() => {
    const T = tickets || [];
    const query = q.toLowerCase();
    return T.filter((t) => (
      (fStat === 'all' || t.status === fStat) &&
      (!fPrio || t.priority === fPrio) &&
      (!query || (t.id + ' ' + titleOf(t) + ' ' + t.customer + ' ' + (t.detail || '') + ' ' + (t.mobile || '')).toLowerCase().includes(query))
    ));
  }, [tickets, q, fStat, fPrio]);
  const { items: pageRows, paging } = useClientPaging(rows, PAGE_SIZE, `${fStat}|${fPrio}|${q}`);

  const deskStaff = useCallback(
    (d) => staff.filter((s) => s.status === 'active' && memberDesks(s).includes(d)),
    [staff],
  );

  const doExport = () => {
    exportCsv(
      'draazy-service-requests.csv',
      ['ID', 'Service', 'Desk', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assigned', 'Status', 'Created'],
      rows.map((t) => [t.id, titleOf(t), DESK_LABEL[t.desk] || t.desk, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.status, asDate(t.createdAt)]),
    );
  };

  const patch = (rec) => {
    if (!rec) return;
    setTickets((list) => (list || []).map((t) => (t.id === rec.id ? rec : t)));
  };

  /* Claim and move are two calls because they are two decisions, and the server may refuse the move.
     Assigning first means a refused move still leaves the ticket owned by someone. */
  const startTicket = async (t) => {
    try {
      const first = t.assignedTo ? null : deskStaff(t.desk)[0];
      if (first) patch(await claimTicket(t.id, first.id));
      patch(await setTicketStatus(t.id, 'in-progress'));
      toast('Marked in progress');
    } catch (e) {
      toast(e?.message || 'That request could not be started.', 'error');
    }
  };

  const claimForMe = async (t) => {
    try {
      patch(await claimTicket(t.id, user?.id));
      toast('Assigned to you');
    } catch (e) {
      toast(e?.message || 'That request could not be claimed.', 'error');
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
      /* Three calls, ordered to leave the least damage if one fails: assignment, then the status the
         server may refuse, then the note — an append, so a colleague's note saved in between survives. */
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

  // Standalone notices keep the page header so an operator can tell which desk they landed on.
  const notice = (body) => {
    const box = <div className="flex flex-col items-center justify-center py-20 text-center">{body}</div>;
    return embedded ? box : (
      <div>
        <PageHeader title={title} subtitle="Route, assign and resolve customer service requests" />
        {box}
      </div>
    );
  };

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

  const withPriority = optionEnabled('services.priority');
  const statusLabel = (s) => `${s.label} ${counts[s.key]}`;

  const rowPrimary = (t) => (
    <>
      {!t.assignedTo && user?.id && t.status !== 'resolved' && t.status !== 'closed' ? (
        <button type="button" onClick={() => claimForMe(t)} className={BTN.ghost}>
          <Hand className="h-3.5 w-3.5" /> Claim
        </button>
      ) : null}
      {t.status === 'open' ? (
        <button type="button" onClick={() => startTicket(t)} className={BTN.primary}>
          <Play className="h-3.5 w-3.5" /> Start
        </button>
      ) : null}
      {t.status === 'in-progress' ? (
        <button type="button" onClick={() => resolveTicket(t)} className={BTN.primary}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
        </button>
      ) : null}
    </>
  );

  /* Values are user ids, not names — two colleagues called Priya are not the same person. The blank
     option is "leave as it is", not "unassign", which has its own sentinel on the server. */
  const staffOpts = active
    ? [{ value: '', label: '— Leave unchanged —' }, ...deskStaff(active.desk).map((s) => ({ value: s.id, label: s.name }))]
    : [{ value: '', label: '— Leave unchanged —' }];

  const kv = active
    ? [
        ['Request ID', active.id],
        ['Service', titleOf(active)],
        ['Desk', DESK_LABEL[active.desk] || active.desk],
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

  const board = (
    <QueuePanel
      idPrefix={idPrefix}
      active={embedded ? 'tickets' : fStat}
      note={NOTE}
      toolbar={(
        <>
          {embedded ? (
            <Chips label="Status" options={STATUS_TABS.map((s) => ({ value: s.key, label: statusLabel(s) }))} value={fStat} onChange={setFStat} />
          ) : null}
          <SearchBox value={q} onChange={setQ} placeholder="Search id, customer, detail…" label="Search tickets" />
          {withPriority ? <Chips label="Priority" options={PRIORITY_CHIPS} value={fPrio} onChange={setFPrio} /> : null}
          {q || fPrio ? <ClearFilters onClick={() => { setQ(''); setFPrio(''); }} /> : null}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={doExport} className={BTN.ghost}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
            <PageNav {...paging} />
          </div>
        </>
      )}
      footer={paging.pageCount > 1 ? <PageNav {...paging} /> : null}
    >
      <RowList isEmpty={!rows.length} empty="No requests match">
        {pageRows.map((t) => (
          <RowCard
            key={t.id}
            id={t.id}
            title={titleOf(t) || '(no subject)'}
            badges={<><Badge status={t.status} />{withPriority ? <Badge status={t.priority} /> : null}<AgeChip ticket={t} /></>}
            meta={<><span>{t.customer}</span>{t.mobile ? <><Dot /><span>{t.mobile}</span></> : null}</>}
            facts={(
              <>
                <FactRow label="Assigned"><Cell className={t.assignedTo ? undefined : 'text-gray-500'}>{t.assignedTo || 'Unassigned'}</Cell></FactRow>
                {t.detail ? <FactRow label="Detail"><span className="col-span-full text-gray-400">{t.detail}</span></FactRow> : null}
              </>
            )}
            primary={rowPrimary(t)}
            icons={<IconAction label="Open" icon={ExternalLink} onClick={() => openTicket(t)} />}
          />
        ))}
      </RowList>
    </QueuePanel>
  );

  return (
    <div>
      {embedded ? board : (
        <>
          <PageHeader title={title} subtitle="Route, assign and resolve customer service requests" />
          <QueueTabs
            label="Ticket statuses"
            idPrefix={idPrefix}
            active={fStat}
            onChange={setFStat}
            tabs={STATUS_TABS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))}
          />
          {board}
        </>
      )}

      <Modal
        open={!!active}
        onClose={closeModal}
        title={active ? 'Request ' + active.id : ''}
        size="lg"
        footer={
          <>
            <button onClick={closeModal} className="dz-btn dz-btn-ghost">
              Close
            </button>
            <button onClick={saveTicket} className="dz-btn dz-btn-primary">
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
                    <div className="mb-1 block text-xs text-gray-400">Assign to</div>
                    <Select value={form.assigneeId} onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))} options={staffOpts} ariaLabel="Assign to" />
                  </div>
                )}
                <div>
                  <div className="mb-1 block text-xs text-gray-400">Status</div>
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
                className="dz-input mt-3 w-full"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
