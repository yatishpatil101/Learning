import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Send } from 'lucide-react';
import { getTicket, listSupportQueue, markTicketRead, replyToTicket } from '../../services/supportService.js';
import { classNames, fmtNum } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { fmtAgo } from './service-queue/helpers.js';

/**
 * The platform-wide support queue (D51).
 *
 * `GET /admin/support-tickets`, which had a server, a partial index and a test suite and no screen.
 *
 * **Not `AdminSupport.jsx`, and not a widening of the customer's own list.** That page is the ops
 * board over `services.ticket.Ticket` — a different resource, on a different provider, about
 * service jobs rather than support conversations. This one reads the support domain, and it is a
 * separate operation from `listTickets` because the two answers have deliberately different shapes:
 * a customer's own history is a short bare array with every message inline, and the platform's
 * whole support traffic in that shape is a PII export by another name.
 *
 * **Why it lives under `/ops` rather than `/admin`.** The endpoint is `x-roles: [staff, admin]` —
 * staff have always been able to read and answer any ticket at `GET /support/tickets/{id}`, so
 * withholding only the index would leave them able to act on tickets they cannot find. The
 * `/admin/*` route group is guarded to `admin` and `manager`: putting the screen there would lock
 * out exactly the audience the server admits, and hand it to managers the server refuses. `/ops` is
 * guarded to `staff` and `admin`, which is the endpoint's audience spelled the same way.
 *
 * ## What a queue screen owes that a table does not
 *
 * **Paging is real.** The envelope's `totalElements` is the whole queue, and the pager moves the
 * server's window rather than slicing rows already in hand — so "412 waiting" is true on page 1 of
 * 21 rather than a description of the twenty rows on screen. Nothing here is computed across rows
 * for exactly that reason; the one filter that matters is applied server-side against V53's partial
 * index.
 *
 * **Awaiting reply is the default view, because that is the working queue.** `awaitingReply` and
 * `unread` are two booleans about two different people and they are not opposites: the first is a
 * customer message nobody on the desk has read, the second is a staff reply the customer has not
 * opened. A queue that showed one number would have the desk chasing people it had already
 * answered.
 *
 * **An empty queue and a failed read say different things.** A `.catch(() => [])` here renders
 * "nothing is waiting" over a broken request, which is the one sentence that ends a shift early.
 *
 * ## Fields, and the one that is missing on purpose
 *
 * `AdminSupportTicket` carries no mobile. That is the contract's decision and this screen keeps it:
 * the ticket detail reveals contact details to the same callers anyway, and a list is the shape
 * that gets exported. `raiser` is a display name and may be null — an account since removed has
 * nobody to name — so the mapper supplies the fallback rather than the cell rendering blank.
 */

const TABS = [
  { key: 'awaiting', label: 'Awaiting reply', awaitingReply: true },
  { key: 'answered', label: 'Answered', awaitingReply: false },
  { key: 'all', label: 'All', awaitingReply: undefined },
];

/* 25, matching the flatmate ops boards. The server's `@PageableDefault` is 20 and either is fine,
   but two desks in the same shell paging at different sizes reads as an accident rather than a
   choice, and an operator moving between them has no way to tell which it is. */
const PAGE_SIZE = 25;

const CATEGORY_LABELS = {
  payment: 'Payments & Refunds',
  rent: 'Rent / HRA',
  listing: 'Property Listing',
  verification: 'Verification / KYC',
  account: 'Account & Login',
  booking: 'Visit / Booking',
  service: 'Home Services',
  technical: 'Technical / Bug',
  other: 'Something else',
};
const catLabel = (k) => CATEGORY_LABELS[k] || 'Something else';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

export default function OpsSupportQueue() {
  const { toast } = useToast();
  const [tab, setTab] = useState('awaiting');
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, error: null });
  const [nonce, setNonce] = useState(0);

  // The open ticket's full thread. Fetched on demand at `GET /support/tickets/{id}` because the
  // queue row deliberately carries none — see the schema note about unbounded list responses.
  const [detail, setDetail] = useState(null);
  const [detailStatus, setDetailStatus] = useState('idle');
  const [reply, setReply] = useState('');
  const sending = useRef(false);

  const load = useCallback(() => {
    const { awaitingReply } = TABS.find((x) => x.key === tab);
    let live = true;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    listSupportQueue({ awaitingReply, page, size: PAGE_SIZE })
      .then((res) => {
        if (live) setState({ status: 'ready', items: res.items, total: res.total, error: null });
      })
      .catch((err) => {
        // Never an empty list. "Nothing is waiting" and "we could not read the queue" are different
        // sentences and only one of them is true.
        if (live) setState({ status: 'error', items: [], total: 0, error: err });
      });
    return () => { live = false; };
  }, [tab, page]);

  useEffect(load, [load, nonce]);

  const switchTab = (key) => { setTab(key); setPage(0); };

  const open = async (row) => {
    setDetail({ id: row.id, subject: row.subject, status: row.status, category: row.category, raiser: row.raiser, messages: [] });
    setReply('');
    setDetailStatus('loading');
    try {
      const full = await getTicket(row.id);
      if (!full) { setDetailStatus('error'); return; }
      setDetail(full);
      setDetailStatus('ready');
      // Clears the desk's side of the two-sided read model and nothing else (D50) — the customer's
      // "support replied" flag is theirs to clear. The row stops being in the working queue, so
      // reflect that locally instead of re-reading the whole page.
      if (row.awaitingReply) {
        await markTicketRead(row.id);
        setState((s) => ({ ...s, items: s.items.map((r) => (r.id === row.id ? { ...r, awaitingReply: false } : r)) }));
      }
    } catch {
      setDetailStatus('error');
    }
  };

  const send = async () => {
    const text = reply.trim();
    if (!text || sending.current || !detail) return;
    sending.current = true;
    try {
      const msg = await replyToTicket(detail.id, text);
      // Append the server's own message rather than an optimistic echo: the id, the author name and
      // the timestamp are all its to decide, and a bubble that disagrees with the next read is a
      // bug the desk reports as "my reply vanished".
      if (msg) setDetail((d) => ({ ...d, messages: [...(d.messages || []), msg] }));
      setReply('');
      toast('Reply sent', 'success');
    } catch {
      toast('That reply could not be sent. Try again.', 'error');
    } finally {
      sending.current = false;
    }
  };

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const from = state.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, state.total);

  const columns = [
    {
      key: 'subject',
      header: 'Ticket',
      render: (t) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{t.subject || '(no subject)'}</div>
          <div className="text-xs text-gray-400">{t.id} · {catLabel(t.category)}</div>
        </div>
      ),
    },
    { key: 'raiser', header: 'Raised by', render: (t) => t.raiser || <span className="text-gray-500">Account removed</span> },
    { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
    {
      key: 'waiting',
      header: 'Waiting on',
      render: (t) => (t.awaitingReply
        ? <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Us</span>
        : t.unread
          ? <span className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-400">Them — unopened</span>
          : <span className="text-gray-500">—</span>),
    },
    { key: 'createdAt', header: 'Opened', render: (t) => <span title={fmtDate(t.createdAt)}>{fmtAgo(t.createdAt) || '—'}</span> },
  ];

  /* Support is worked from a phone as often as a desk, so the table gets the stacked-card fallback
     below `sm` that every other ops queue has (see Table.jsx). */
  const card = (t) => (
    <button type="button" onClick={() => open(t)} className="dz-card block w-full p-3.5 text-left">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.subject || '(no subject)'}</div>
          <div className="mt-0.5 text-xs text-gray-400">{t.id} · {catLabel(t.category)}</div>
        </div>
        <div className="shrink-0"><Badge status={t.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span>{t.raiser || 'Account removed'}</span>
        <span className="text-gray-600">·</span>
        <span>{fmtAgo(t.createdAt)}</span>
        {t.awaitingReply ? (<><span className="text-gray-600">·</span><span className="text-amber-300">Waiting on us</span></>) : null}
      </div>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Support queue"
        subtitle="Every support conversation on the platform, newest first."
        actions={
          <button onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-ghost">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => switchTab(x.key)}
            className={classNames(
              'rounded-xl border px-3 py-1.5 text-sm',
              tab === x.key ? 'border-teal-400/40 bg-teal-500/10 text-teal-200' : 'border-white/10 text-gray-400 hover:bg-white/5',
            )}
          >
            {x.label}
          </button>
        ))}
        {state.status === 'ready' ? (
          <span className="ml-auto text-xs text-gray-400">
            {state.total ? `Showing ${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(state.total)}` : 'Nothing in this view'}
          </span>
        ) : null}
      </div>

      {state.status === 'loading' ? <Loading label="Loading the support queue…" /> : null}

      {state.status === 'error' ? (
        <div className="dz-card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-gray-300">
            We could not read the support queue. This is not an empty queue — nothing was loaded.
          </p>
          <button onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-primary">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Table
            columns={columns}
            rows={state.items}
            onRowClick={open}
            label="tickets"
            empty={tab === 'awaiting' ? 'Nothing is waiting on us. Every customer message has been read.' : 'No tickets in this view.'}
            mobileCard={card}
          />
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="dz-btn dz-btn-ghost disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-gray-400">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="dz-btn dz-btn-ghost disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <Modal
        open={!!detail}
        onClose={() => { setDetail(null); setDetailStatus('idle'); }}
        title={detail ? `${detail.id} · ${detail.subject || '(no subject)'}` : ''}
        size="lg"
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge status={detail.status} />
              <span className="text-gray-400">{catLabel(detail.category)}</span>
              {detail.raiser ? (<><span className="text-gray-600">·</span><span className="text-gray-400">{detail.raiser}</span></>) : null}
            </div>

            {detailStatus === 'loading' ? <Loading label="Loading the conversation…" /> : null}

            {detailStatus === 'error' ? (
              <p className="text-sm text-gray-300">
                We could not open this conversation. Close this and try again — the ticket is still there.
              </p>
            ) : null}

            {detailStatus === 'ready' ? (
              <>
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {(detail.messages || []).length === 0 ? (
                    <li className="text-sm text-gray-500">This ticket has no messages.</li>
                  ) : (
                    detail.messages.map((m) => (
                      <li
                        key={m.id}
                        className={classNames(
                          'rounded-xl border p-3 text-sm',
                          m.by === 'staff' ? 'border-teal-400/20 bg-teal-500/5' : 'border-white/5 bg-white/5',
                        )}
                      >
                        <div className="text-gray-200">{m.text}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {m.name || (m.by === 'staff' ? 'Support' : 'Customer')} · {fmtAgo(m.at)}
                        </div>
                      </li>
                    ))
                  )}
                </ul>

                <div className="flex gap-2">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder="Reply to the customer…"
                    aria-label="Reply to the customer"
                    className="dz-input flex-1"
                  />
                  <button onClick={send} disabled={!reply.trim()} className="dz-btn dz-btn-primary disabled:opacity-40">
                    <Send className="h-4 w-4" /> Send
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
