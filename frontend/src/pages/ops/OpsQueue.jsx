import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, ExternalLink, Hand, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  addTicketNote, claimTicket, listTicketQueue, setTicketStatus as moveTicket,
} from '../../services/ticketService.js';
import { isHttpDomain } from '../../services/config.js';
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
import { fmtAgo } from './service-queue/helpers.js';

const STATUS_OPTS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];
const PRIORITY = { urgent: 'text-red-400', high: 'text-red-300', medium: 'text-amber-300', low: 'text-gray-400' };
const asDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/**
 * The window this board reads, and why it is a window rather than a page.
 *
 * Everything above the table is computed *across rows* — the four count tiles, "assigned to me",
 * and the free-text search. Those numbers are wrong the moment they are taken from one page of a
 * paged list: "3 open" on page 1 of 4 is not a fact about the queue, and a search that answers
 * "no tickets" because the match is on page 2 is worse than no search at all. So this asks for a
 * generous window and does its arithmetic over what came back, the same call the reports queue
 * made for the same reason. When the window is not the whole board the screen says so, rather
 * than quietly presenting a partial count as a total.
 */
const WINDOW = 100;

/* Shared queue used by every ops team page. `team` scopes the tickets, but only as a *request* —
   `TicketService.list` decides what a caller may see and refuses a staffer another desk by name
   (the same server-side rule as D44 for service requests). The board no longer recomputes that
   rule client-side; it asks and renders the answer, including the refusal. */
export default function OpsQueue({ title, subtitle, team = null }) {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const liveApi = isHttpDomain('ticket');
  const [state, setState] = useState(() => ({ status: liveApi ? 'loading' : 'offline', items: [], total: 0, error: '' }));
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [nonce, setNonce] = useState(0);
  const meName = user?.name || 'Me';

  const load = useCallback(() => {
    if (!liveApi) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    listTicketQueue({ team: team || undefined, size: WINDOW })
      .then((res) => alive && setState({ status: 'ready', items: res.items, total: res.total, error: '' }))
      /* Not `items: []`. A queue that renders an unread failure as an empty board is how a desk
         goes home early — and a 403 here is information, not an outage: it means this account was
         refused a desk that is not theirs, which is a sentence worth showing. */
      .catch((e) => alive && setState({ status: 'error', items: [], total: 0, error: e?.message || 'The queue could not be read.' }));
    return () => { alive = false; };
  }, [liveApi, team]);

  useEffect(load, [load, nonce]);

  const all = state.items;
  const reload = () => setNonce((n) => n + 1);

  const patch = (rec) => {
    if (!rec) return;
    setState((s) => ({ ...s, items: s.items.map((t) => (t.id === rec.id ? rec : t)) }));
    setDetail((d) => (d && d.id === rec.id ? rec : d));
  };

  const setTicketStatus = async (id, next) => {
    try {
      patch(await moveTicket(id, next));
      toast('Ticket updated', 'success');
    } catch (e) {
      toast(e?.message || 'That status could not be set.', 'error');
    }
  };
  /* Self-claim only. The endpoint takes any ops user id, but handing work to a named stranger
     needs a staff directory this portal does not have — see `ticketService.claimTicket`. */
  const claim = async (t) => {
    try {
      patch(await claimTicket(t.id, user?.id));
      toast('Assigned to you', 'success');
    } catch (e) {
      toast(e?.message || 'That ticket could not be claimed.', 'error');
    }
  };
  /* An append, not a rewrite: the old board sent the whole `notes` array back, so whichever of two
     colleagues saved second erased the other. The server returns just the new note. */
  const addNote = async () => {
    if (!note.trim() || !detail) return;
    try {
      const added = await addTicketNote(detail.id, note.trim());
      patch({ ...detail, notes: [...(detail.notes || []), added] });
      setNote('');
      toast('Note added');
    } catch (e) {
      toast(e?.message || 'That note could not be saved.', 'error');
    }
  };

  const counts = useMemo(() => {
    const list = all || [];
    return {
      total: list.length,
      open: list.filter((t) => t.status === 'open').length,
      progress: list.filter((t) => t.status === 'in-progress').length,
      resolved: list.filter((t) => t.status === 'resolved').length,
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

  /* The board reads `GET /tickets`, which the mock store cannot answer: it knows three statuses
     where the server knows five, assigns by display name where the server assigns by user id, and
     hands back everything where the server pages. D184 refused that translation table for the
     drafting desk; this says so out loud rather than rendering an empty board, because an empty
     queue and a queue nobody can see look identical and only one of them is good news. */
  if (!liveApi) {
    return (
      <div>
        <PageHeader title={title} subtitle={subtitle} />
        <div className="pn-card flex items-start gap-3 p-5 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">This board needs the live API.</p>
            <p className="mt-1 text-amber-200/80">
              Tickets live on the server, and the demo data cannot speak its status vocabulary. Rather
              than show you an empty queue that might be hiding real work, the board stays shut.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div>
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={<button onClick={reload} className="pn-btn pn-btn-ghost"><RefreshCw className="h-4 w-4" /> Try again</button>}
        />
        <div className="pn-card flex items-start gap-3 p-5 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">The queue could not be read.</p>
            <p className="mt-1 text-amber-200/80">{state.error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') return <Loading />;

  const windowed = state.total > all.length;
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
          {t.status === 'open' ? (
            <button onClick={(e) => { e.stopPropagation(); claim(t); }} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300"><Hand className="h-3 w-3" />Claim</button>
          ) : t.status === 'in-progress' ? (
            <button onClick={(e) => { e.stopPropagation(); setTicketStatus(t.id, 'resolved'); }} className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"><Check className="h-3 w-3" />Resolve</button>
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
        {t.status === 'open' ? (
          <button onClick={() => claim(t)} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 text-sm text-indigo-300"><Hand className="h-4 w-4" />Claim</button>
        ) : t.status === 'in-progress' ? (
          <button onClick={() => setTicketStatus(t.id, 'resolved')} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 text-sm text-emerald-300"><Check className="h-4 w-4" />Resolve</button>
        ) : null}
        <button onClick={() => { setDetail(t); setNote(''); }} className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm text-gray-300"><ExternalLink className="h-4 w-4" />Open</button>
      </div>
    </div>
  );

  const doExport = () =>
    exportCsv(
      `punenest-${team || 'requests'}.csv`,
      ['ID', 'Team', 'Service', 'Customer', 'Mobile', 'Detail', 'Priority', 'Assignee', 'Value', 'Status', 'Created'],
      rows.map((t) => [t.id, t.team, t.service, t.customer, t.mobile, t.detail, t.priority, t.assignedTo || '', t.value || 0, t.status, asDate(t.createdAt)]),
    );

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <button onClick={reload} className="pn-btn pn-btn-ghost">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={doExport} className="pn-btn pn-btn-ghost">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </>
        }
      />

      {/* Said rather than implied. Every number on this screen is counted over the rows in hand,
          so when the board is longer than the window they are counts of the newest 100 and not of
          the queue — which is a different sentence and has to read like one. */}
      {windowed ? (
        <p className="mb-4 text-xs text-amber-200/80">
          Showing the {fmtNum(all.length)} newest of {fmtNum(state.total)} tickets. The counts and the
          search below cover only those.
        </p>
      ) : null}

      {/* A group with a name, because each tile's own accessible name is its count followed by its
          label ("12 Open") — fine to look at, useless to address, and it changes every time the
          queue does. The name below is stable and says what the strip is for. */}
      <div role="group" aria-label="Ticket counts" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['All', counts.total, ''],
          ['Open', counts.open, 'open'],
          ['In progress', counts.progress, 'in-progress'],
          ['Resolved', counts.resolved, 'resolved'],
        ].map(([label, count, key]) => (
          <button
            key={label}
            onClick={() => setStatus(key)}
            aria-pressed={status === key}
            aria-label={key ? `Show ${label.toLowerCase()} tickets` : 'Show all tickets'}
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

      {/* pageSize was copied from `AdminSupport`, which rendered the same `listTickets` data —
          this queue was the only one that never got it, so it rendered every ticket
          at once (measured 1,857 DOM nodes / 34 rows on /ops/requests, and it grows
          with the backlog). Past tense: that page had already been merged into
          `AdminServices` and its route left as a redirect, and the orphaned component has
          since been deleted. The number is still the right one; the sibling it was matched
          against is gone. Field-ops staff open this on a phone, where a long DOM
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
                ['Created', fmtAgo(detail.createdAt)],
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
                <button onClick={() => claim(detail)} disabled={detail.assignedTo === meName} className="pn-btn pn-btn-ghost w-full disabled:opacity-60">
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
