import { useCallback, useEffect, useState } from 'react';
import { decideErasureRequest, listErasureRequests } from '../../services/erasureService.js';
import { classNames, fmtAgo } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Modal from '../../components/ui/Modal.jsx';
import {
  BTN, CHIP, CHIP_TONE, Chips, FactRow, PageNav, QueuePanel, RowCard, RowList,
} from '../../components/admin/WorkQueue.jsx';

const PAGE_SIZE = 20;
const NOTE_MAX = 2000;

const STATUS_CHIPS = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Erased' },
  { value: 'rejected', label: 'Rejected' },
  { value: '', label: 'All' },
];
const STATUS_LABEL = { pending: 'Pending', completed: 'Erased', rejected: 'Rejected' };
const STATUS_TONE = { pending: 'amber', completed: 'green', rejected: 'red' };

const Dot = () => <span className="text-gray-600" aria-hidden="true">{'\u00b7'}</span>;

function RequestRow({ r, onDecide }) {
  return (
    <RowCard
      id={r.id}
      testId="erasure-request"
      title={`Request ${r.id.slice(0, 8)}`}
      badges={<span className={classNames(CHIP, CHIP_TONE[STATUS_TONE[r.status] || 'neutral'])}>{STATUS_LABEL[r.status] || r.status}</span>}
      meta={(
        <>
          <span title={r.requestedAt}>Filed {fmtAgo(r.requestedAt)}</span>
          {r.decidedAt ? <><Dot /><span title={r.decidedAt}>Decided {fmtAgo(r.decidedAt)}</span></> : null}
        </>
      )}
      facts={(
        <>
          <FactRow label="Reason"><span className="col-span-full whitespace-pre-wrap break-words">{r.reason || '\u2014'}</span></FactRow>
          {r.decisionNote ? <FactRow label="Note"><span className="col-span-full whitespace-pre-wrap break-words">{r.decisionNote}</span></FactRow> : null}
        </>
      )}
      primary={r.status === 'pending' ? (
        <>
          <button type="button" onClick={() => onDecide(r, 'execute')} className={BTN.danger}>Erase data</button>
          <button type="button" onClick={() => onDecide(r, 'reject')} className={BTN.ghost}>Reject</button>
        </>
      ) : null}
    />
  );
}

export default function AdminErasureRequests() {
  const { toast } = useToast();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listErasureRequests({ status, page: page - 1, size: PAGE_SIZE })
    .then((res) => { setLoadError(''); setData(res); }), [status, page]);

  useEffect(() => {
    let alive = true;
    setData((prev) => (prev ? { ...prev, stale: true } : prev));
    load().catch((err) => {
      if (!alive) return;
      setLoadError(err?.message || 'Could not load erasure requests');
      setData({ items: [], total: 0, totalPages: 0 });
    });
    return () => { alive = false; };
  }, [load]);

  const closeDecision = () => { if (busy) return; setDecision(null); setNote(''); setError(''); };
  const reject = decision?.action === 'reject';
  const noteMissing = reject && !note.trim();

  const confirmDecision = async () => {
    if (!decision || busy || noteMissing) return;
    setBusy(true);
    setError('');
    try {
      await decideErasureRequest(decision.request.id, decision.action, note);
    } catch (err) {
      setError(err?.message || 'That request could not be decided');
      load().catch(() => {});
      setBusy(false);
      return;
    }
    setBusy(false);
    toast(reject ? 'Erasure request rejected' : 'Data erased', 'success');
    setDecision(null);
    setNote('');
    load().catch((err) => setLoadError(err?.message || 'Could not load erasure requests'));
  };

  if (!data) return <Loading />;

  return (
    <div>
      <PageHeader title="Erasure requests" subtitle="Right-to-erasure requests. Erasing is permanent." />
      {loadError ? <div role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{loadError}</div> : null}
      <QueuePanel
        toolbar={(
          <>
            <Chips label="Status" options={STATUS_CHIPS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
            <div className="ml-auto">
              <PageNav
                page={page}
                pageCount={Math.max(1, data?.totalPages || 1)}
                total={data?.total || 0}
                size={PAGE_SIZE}
                onPage={setPage}
                stale={!data || data.stale}
              />
            </div>
          </>
        )}
      >
        <RowList isEmpty={!data?.items.length} empty="No erasure requests.">
          {data?.items.map((r) => <RequestRow key={r.id} r={r} onDecide={(request, action) => setDecision({ request, action })} />)}
        </RowList>
      </QueuePanel>

      <Modal
        open={!!decision}
        onClose={closeDecision}
        title={reject ? 'Reject erasure request' : 'Erase this person\u2019s data'}
        footer={(
          <>
            <button type="button" onClick={closeDecision} className="dz-btn dz-btn-ghost">Cancel</button>
            <button type="button" onClick={confirmDecision} disabled={busy || noteMissing} className="dz-btn dz-btn-primary disabled:opacity-50">
              {busy ? 'Working\u2026' : reject ? 'Reject' : 'Erase permanently'}
            </button>
          </>
        )}
      >
        {decision ? (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300">{decision.request.reason || 'No reason given.'}</p>
            {reject ? null : <p className="text-sm text-amber-200">This archives the account and clears its name, phone number, email and documents. Records we must keep (payments, rent agreements, deals) stay. It cannot be undone.</p>}
            {error ? <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}
            <label className="block">
              <span className="text-xs text-gray-400">{reject ? 'Reason for the person (required)' : 'Note (optional)'}</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} rows={3} className="mt-1 dz-input resize-none text-sm" />
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
