import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, Send } from 'lucide-react';
import { getTicket, listSupportQueue, replyToTicket } from '../../services/supportService.js';
import { classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, PageNav, QueuePanel, QueueTabs, RowCard, RowList,
} from '../../components/admin/WorkQueue.jsx';
import { fmtAgo } from './service-queue/helpers.js';

/** The platform-wide support queue (`GET /admin/support-tickets`); under `/ops` because `/admin/*` locks out staff.
 * Paging and counts are server-side, and the list carries no mobile by contract. */

const TABS = [
  { key: 'awaiting', label: 'Awaiting reply', awaitingReply: true },
  { key: 'answered', label: 'Answered', awaitingReply: false },
  { key: 'all', label: 'All', awaitingReply: undefined },
];
const NOTES = {
  awaiting: 'Customer messages nobody on the desk has read yet. Opening a ticket marks it read.',
  answered: 'Tickets the desk has read. "Unopened" means the customer has not seen our reply yet.',
  all: 'Every support conversation on the platform, newest first.',
};

// Matches the flatmate ops boards, so desks in the same shell page alike.
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
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

export default function OpsSupportQueue() {
  const { toast } = useToast();
  const [tab, setTab] = useState('awaiting');
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, error: null });
  const [counts, setCounts] = useState({});
  const [nonce, setNonce] = useState(0);

  const [detail, setDetail] = useState(null);
  const [detailStatus, setDetailStatus] = useState('idle');
  const [reply, setReply] = useState('');
  const sending = useRef(false);
  const wantCounts = useRef(true);

  const load = useCallback(() => {
    const { awaitingReply } = TABS.find((x) => x.key === tab);
    let live = true;
    const counts = wantCounts.current;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    listSupportQueue({ awaitingReply, page, size: PAGE_SIZE, counts })
      .then((res) => {
        if (!live) return;
        setState({ status: 'ready', items: res.items, total: res.total, error: null });
        if (counts) {
          wantCounts.current = false;
          setCounts(res.counts || {});
        }
      })
      .catch((err) => {
        // Never an empty list: "nothing is waiting" over a failed read ends a shift early.
        if (live) setState({ status: 'error', items: [], total: 0, error: err });
      });
    return () => { live = false; };
  }, [tab, page]);

  useEffect(load, [load, nonce]);

  const switchTab = (key) => { setTab(key); setPage(0); };
  const reload = () => { wantCounts.current = true; setNonce((n) => n + 1); };

  const open = async (row) => {
    setDetail({ id: row.id, subject: row.subject, status: row.status, category: row.category, raiser: row.raiser, messages: [] });
    setReply('');
    setDetailStatus('loading');
    try {
      const full = await getTicket(row.id);
      if (!full) { setDetailStatus('error'); return; }
      setDetail(full);
      setDetailStatus('ready');
      // The staff read clears the desk's side of the read model; the customer's flag is theirs to clear.
      if (row.awaitingReply) {
        setState((s) => ({ ...s, items: s.items.map((r) => (r.id === row.id ? { ...r, awaitingReply: false } : r)) }));
        setCounts((c) => ({ ...c, awaiting: c.awaiting > 0 ? c.awaiting - 1 : c.awaiting, answered: c.answered != null ? c.answered + 1 : c.answered }));
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
      // The server's own message, not an optimistic echo: id, author and time are its to decide.
      const msg = await replyToTicket(detail.id, text);
      if (msg) setDetail((d) => ({ ...d, messages: [...(d.messages || []), msg] }));
      setReply('');
      toast('Reply sent', 'success');
    } catch {
      toast('That reply could not be sent. Try again.', 'error');
    } finally {
      sending.current = false;
    }
  };

  const paging = { page: page + 1, pageCount: Math.max(1, Math.ceil(state.total / PAGE_SIZE)), total: state.total, size: PAGE_SIZE, onPage: (p) => setPage(p - 1) };
  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? null }));

  const waiting = (t) => {
    if (t.awaitingReply) return <span className={classNames(CHIP, CHIP_TONE.amber)}>Waiting on us</span>;
    if (t.unread) return <span className={classNames(CHIP, CHIP_TONE.neutral)}>Unopened by customer</span>;
    return null;
  };

  return (
    <div>
      <PageHeader title="Support queue" subtitle="Every support conversation on the platform, newest first." />

      <QueueTabs label="Support queue views" active={tab} onChange={switchTab} tabs={tabs} />

      <QueuePanel
        active={tab}
        note={NOTES[tab]}
        toolbar={(
          <>
            <button type="button" onClick={reload} className={BTN.ghost}>
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
            {state.status === 'ready' ? <div className="ml-auto"><PageNav {...paging} /></div> : null}
          </>
        )}
        footer={state.status === 'ready' && paging.pageCount > 1 ? <PageNav {...paging} /> : null}
      >
        {state.status === 'loading' ? <Loading label="Loading the support queue…" /> : null}

        {state.status === 'error' ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-gray-300">
              We could not read the support queue. This is not an empty queue — nothing was loaded.
            </p>
            <button type="button" onClick={reload} className="dz-btn dz-btn-primary">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : null}

        {state.status === 'ready' ? (
          <RowList isEmpty={!state.items.length} empty={tab === 'awaiting' ? 'Nothing is waiting on us. Every customer message has been read.' : 'No tickets in this view.'}>
            {state.items.map((t) => (
              <RowCard
                key={t.id}
                id={t.id}
                title={t.subject || '(no subject)'}
                badges={<><Badge status={t.status} />{waiting(t)}</>}
                meta={(
                  <>
                    <span>{t.raiser || 'Account removed'}</span>
                    <Dot />
                    <span>{catLabel(t.category)}</span>
                    <Dot />
                    <span title={fmtDate(t.createdAt)}>Opened {fmtAgo(t.createdAt) || '—'}</span>
                  </>
                )}
                primary={(
                  <button type="button" onClick={() => open(t)} className={t.awaitingReply ? BTN.primary : BTN.ghost}>
                    <MessageSquare className="h-3.5 w-3.5" />{t.awaitingReply ? 'Reply' : 'View thread'}
                  </button>
                )}
              />
            ))}
          </RowList>
        ) : null}
      </QueuePanel>

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
                  <button type="button" onClick={send} disabled={!reply.trim()} className="dz-btn dz-btn-primary disabled:opacity-40">
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
