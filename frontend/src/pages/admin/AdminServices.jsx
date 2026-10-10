import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Clock, Download, ExternalLink, Hand, Play, Save } from 'lucide-react';
import { addTicketNote, claimTicket, getTicket, getTicketSummary, listTicketQueue, setTicketStatus } from '../../services/ticketService.js';
import { listAssignees } from '../../services/teamService.js';
import { TEAM_LABEL as DESK_LABEL } from '../../lib/data/tickets.js';
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
  BTN, CHIP, CHIP_TONE, Cell, Chips, ClearFilters, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox,
} from '../../components/admin/WorkQueue.jsx';

/* The server's `TicketStatuses` vocabulary (incl. `waiting`, `closed`); `PATCH /tickets/{id}` 400s on `done`. */
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

/* Counts come from the summary and the list is server-paged, so a page of rows never stands in for the desk. */
const PAGE_SIZE = 10;
const EXPORT_SIZE = 100;
const SUMMARY_KEY = { open: 'open', 'in-progress': 'inProgress', waiting: 'waiting', resolved: 'resolved', closed: 'closed', all: 'all' };

const asDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
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

  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [token, setToken] = useState(0);
  const reload = useCallback(() => setToken((n) => n + 1), []);

  const [q, setQ] = useState('');
  const [fStat, setFStat] = useState('open');
  const [fPrio, setFPrio] = useState('');
  const [page, setPage] = useState(1);
  const filterKey = `${fStat}|${fPrio}|${q}`;
  const [pageKey, setPageKey] = useState(filterKey);
  if (pageKey !== filterKey) {
    setPageKey(filterKey);
    setPage(1);
  }

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [form, setForm] = useState({ assigneeId: '', status: 'open', note: '' });

  const filters = useCallback(() => ({
    team: desk, status: fStat === 'all' ? undefined : fStat, priority: fPrio || undefined, q: q.trim() || undefined,
  }), [desk, fStat, fPrio, q]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      listTicketQueue({ ...filters(), page: page - 1, size: PAGE_SIZE })
        .then((res) => { if (alive) { setResult(res); setLoadError(''); } })
        // Not an empty board: an unread failure rendered as "nothing to do" is how a desk goes home early.
        .catch((e) => { if (alive) setLoadError(e?.message || 'The service requests could not be read.'); });
    }, q.trim() ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [filters, q, page, token]);

  useEffect(() => {
    let alive = true;
    getTicketSummary(desk).then((s) => { if (alive) setSummary(s); }, () => { if (alive) setSummary(null); });
    return () => {
      alive = false;
    };
  }, [desk, token]);

  useEffect(() => {
    let alive = true;
    // The directory maps "Priya" to the id `TicketUpdate.assigneeId` takes; desk staff can only claim for self.
    if (role !== 'staff') listAssignees().then((list) => { if (alive) setStaff(list); }, () => {});
    return () => {
      alive = false;
    };
  }, [role]);

  const title = DESK_LABEL[desk] || desk;

  const openTicket = useCallback((t) => {
    setDetail(null);
    setDetailFailed(false);
    setForm({ assigneeId: '', status: t.status, note: '' });
    setOpenId(t.id);
  }, []);

  // ?open=<id> opens that ticket once per mount, so it does not re-open while the param clears.
  const deepLinkId = useRef(null);
  useEffect(() => {
    const tid = searchParams.get('open');
    if (!tid || deepLinkId.current) return;
    deepLinkId.current = tid;
    setOpenId(tid);
  }, [searchParams]);

  useEffect(() => {
    if (!openId) return undefined;
    let alive = true;
    getTicket(openId)
      .then((res) => {
        if (!alive) return;
        if (!res) { setDetailFailed(true); return; }
        setDetail(res);
        setForm((f) => ({ ...f, status: res.status }));
        if (deepLinkId.current === openId) setFStat(res.status);
      })
      .catch(() => { if (alive) setDetailFailed(true); });
    return () => {
      alive = false;
    };
  }, [openId]);

  const rows = result?.items || [];
  const total = result?.total ?? 0;
  const paging = { page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, size: PAGE_SIZE, onPage: setPage };
  const count = (key) => (summary ? summary[SUMMARY_KEY[key]] : null);

  const deskStaff = useCallback((d) => staff.filter((s) => s.desks.includes(d)), [staff]);

  const doExport = async () => {
    try {
      const res = await listTicketQueue({ ...filters(), page: 0, size: EXPORT_SIZE });
      exportCsv(
        'draazy-service-requests.csv',
        ['ID', 'Service', 'Desk', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assigned', 'Status', 'Created'],
        res.items.map((t) => [t.id, titleOf(t), DESK_LABEL[t.desk] || t.desk, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.status, asDate(t.createdAt)]),
      );
    } catch (e) {
      toast(e?.message || 'The export could not be read.', 'error');
    }
  };

  /* Claim and move are two calls because they are two decisions, and the server may refuse the move.
     Assigning first means a refused move still leaves the ticket owned by someone. */
  const startTicket = async (t) => {
    try {
      const first = t.assignedTo ? null : deskStaff(t.desk)[0];
      if (first) await claimTicket(t.id, first.id);
      await setTicketStatus(t.id, 'in-progress');
      toast('Marked in progress');
    } catch (e) {
      toast(e?.message || 'That request could not be started.', 'error');
    }
    reload();
  };

  const claimForMe = async (t) => {
    try {
      await claimTicket(t.id, user?.id);
      toast('Assigned to you');
    } catch (e) {
      toast(e?.message || 'That request could not be claimed.', 'error');
    }
    reload();
  };

  const resolveTicket = async (t) => {
    try {
      await setTicketStatus(t.id, 'resolved');
      toast('Request resolved');
    } catch (e) {
      toast(e?.message || 'That request could not be resolved.', 'error');
    }
    reload();
  };

  const active = detail;

  const clearOpenParam = () => {
    if (searchParams.get('open')) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  };

  const closeModal = () => {
    setOpenId(null);
    setDetail(null);
    clearOpenParam();
  };

  const saveTicket = async () => {
    if (!active) return;
    try {
      /* Three calls, ordered to leave the least damage if one fails: assignment, then the status the
         server may refuse, then the note — an append, so a colleague's note saved in between survives. */
      if (form.assigneeId && form.assigneeId !== '__keep__') await claimTicket(active.id, form.assigneeId);
      if (form.status && form.status !== active.status) await setTicketStatus(active.id, form.status);
      const note = form.note.trim();
      if (note) await addTicketNote(active.id, note);
      closeModal();
      reload();
      toast('Request updated');
    } catch (e) {
      toast(e?.message || 'That request could not be updated.', 'error');
    }
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

  if (loadError) {
    return notice(<div className="text-red-300 text-sm">{loadError}</div>);
  }

  if (!result || flagsLoading) return <Loading />;

  if (!optionEnabled('services.enabled')) {
    return notice(
      <>
        <div className="text-gray-500 text-sm">Services module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </>,
    );
  }

  const statusLabel = (s) => (count(s.key) == null ? s.label : `${s.label} ${count(s.key)}`);

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
          <Chips label="Priority" options={PRIORITY_CHIPS} value={fPrio} onChange={setFPrio} />
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
        {rows.map((t) => (
          <RowCard
            key={t.id}
            id={t.id}
            title={titleOf(t) || '(no subject)'}
            badges={<><Badge status={t.status} /><Badge status={t.priority} /><AgeChip ticket={t} /></>}
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
            tabs={STATUS_TABS.map((s) => ({ key: s.key, label: s.label, count: count(s.key) }))}
          />
          {board}
        </>
      )}

      <Modal
        open={!!openId}
        onClose={closeModal}
        title={'Request ' + (openId || '')}
        size="lg"
        footer={
          <>
            <button onClick={closeModal} className="dz-btn dz-btn-ghost">
              Close
            </button>
            <button onClick={saveTicket} disabled={!active} className="dz-btn dz-btn-primary">
              <Save className="h-4 w-4" /> Save
            </button>
          </>
        }
      >
        {detailFailed ? (
          <div className="text-red-300 text-sm">This request could not be opened.</div>
        ) : !active ? (
          <Loading />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <div className="text-lg font-bold">{titleOf(active)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge status={active.status} />
                  <Badge status={active.priority} />
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
                <div>
                  <div className="mb-1 block text-xs text-gray-400">Assign to</div>
                  <Select value={form.assigneeId} onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))} options={staffOpts} ariaLabel="Assign to" />
                </div>
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
        )}
      </Modal>
    </div>
  );
}
