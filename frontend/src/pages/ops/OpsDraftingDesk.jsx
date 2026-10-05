import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Hand, RefreshCw, Search } from 'lucide-react';
import {
  addServiceRequestMessage, cancelServiceRequestAsOps, listServiceRequestQueue,
  readServiceRequestChecklist, shareServiceRequestDraft,
  takeServiceRequest, uploadServiceRequestFinalDoc, checkServiceRequestDraft,
} from '../../services/serviceRequestService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { DESK_BY_VALUE } from '../../lib/adminModules.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import InternalNote, { saveNoteIfAny } from '../../components/ui/InternalNote.jsx';
import AgeTone from './service-queue/AgeTone.jsx';
import CancelDialog from './service-queue/CancelDialog.jsx';
import MessageThread from './service-queue/MessageThread.jsx';
import DocumentChecklist from './service-queue/DocumentChecklist.jsx';
import ServiceDocuments from './service-queue/ServiceDocuments.jsx';
import StaffWorkflowActions from './service-queue/StaffWorkflowActions.jsx';
import DraftSecondCheck from './service-queue/DraftSecondCheck.jsx';
import PartyIdentities from './service-queue/PartyIdentities.jsx';
import { fmtAgo } from './service-queue/helpers.js';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** Full server transition vocabulary; missing states make filtered desks look falsely idle. */
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'draft-shared', label: 'Draft shared' },
  { value: 'changes-requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Allow-list details so free-form `_state` snapshots cannot leak mobile or identity fields. */
const DETAIL_FIELDS = [
  ['property', 'Property'],
  ['location', 'Location'],
  ['ownerName', 'Owner'],
  ['tenants', 'Tenant(s)'],
  ['rent', 'Monthly rent', 'inr'],
  ['deposit', 'Deposit', 'inr'],
  ['months', 'Term (months)'],
  ['startDate', 'Start date'],
  ['regArea', 'Registration area'],
  ['service', 'Service needed'],
  ['scope', 'Scope'],
  ['rooms', 'Rooms'],
  ['budget', 'Budget', 'inr'],
  ['timeline', 'Timeline'],
  ['ptype', 'Property type'],
  ['area', 'Area'],
  ['purpose', 'Purpose'],
  ['from', 'Moving from'],
  ['to', 'Moving to'],
  ['moveDate', 'Move date'],
  ['homeSize', 'Home size'],
];

/** Named, scalar, non-empty `details` entries only — see `DETAIL_FIELDS`. */
function detailRows(details) {
  const d = details || {};
  return DETAIL_FIELDS
    .filter(([key]) => {
      const v = d[key];
      return v !== null && v !== undefined && v !== '' && typeof v !== 'object';
    })
    .map(([key, label, fmt]) => [label, fmt === 'inr' ? fmtINR(d[key]) : String(d[key])]);
}

/** The one-line summary the queue row shows. Same allow-list, first hit wins. */
const summaryOf = (r) => {
  const rows = detailRows(r.details);
  return rows.length ? rows[0][1] : '—';
};

/** One service desk's queue (legal, interior, packers, valuation). Rent agreements have their own
 *  case view in `rent-agreement/`; home loans are tickets on `AdminServices`. */
export default function OpsDraftingDesk({ desk }) {
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(0);
  const [state, setState] = useState(() => ({ status: 'loading', items: [], total: 0 }));
  const [nonce, setNonce] = useState(0);

  const [detail, setDetail] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [checklistStatus, setChecklistStatus] = useState('idle');
  const [internalNote, setInternalNote] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    listServiceRequestQueue({
      type: desk,
      status: status || undefined,
      unassigned,
      q: query || undefined,
      page,
      size: PAGE_SIZE,
    })
      .then((res) => { if (live) setState({ status: 'ready', items: res.items, total: res.total }); })
      // Never `[]`: an unread queue that renders as an empty one is how a desk goes home early.
      .catch(() => { if (live) setState({ status: 'error', items: [], total: 0 }); });
    return () => { live = false; };
  }, [desk, status, unassigned, query, page]);

  useEffect(load, [load, nonce]);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const detailId = detail?.id || null;
  useEffect(() => {
    if (!detailId) return undefined;
    let live = true;
    setChecklist(null);
    setChecklistStatus('loading');
    readServiceRequestChecklist(detailId)
      .then((res) => { if (live) { setChecklist(res); setChecklistStatus('ready'); } })
      /* Not `{ items: [] }`. A failed read rendered as an empty checklist tells a desk the customer
         has sent nothing, which is how somebody ends up chasing documents that are already filed. */
      .catch(() => { if (live) { setChecklist(null); setChecklistStatus('error'); } });
    return () => { live = false; };
  }, [detailId]);

  const closeDetail = () => {
    setDetail(null);
    setInternalNote('');
  };

  const openDetail = (row) => {
    setInternalNote('');
    setDetail(row);
  };

  const applyUpdate = (updated) => {
    if (!updated) return;
    setDetail((d) => (d?.id === updated.id ? updated : d));
    setState((s) => ({ ...s, items: s.items.map((r) => (r.id === updated.id ? updated : r)) }));
  };

  const fileInternalNote = async (action) => {
    if (!detail) return;
    const result = await saveNoteIfAny('service_request', detail.id, internalNote, action);
    if (result.error) toast('The request changed, but the internal note was not saved.', 'error');
    if (result.written) setInternalNote('');
  };

  const take = async () => {
    if (!detail || busy.current) return;
    busy.current = true;
    try {
      const updated = await takeServiceRequest(detail.id);
      applyUpdate(updated);
      toast('This request is now yours. The customer can see the change.', 'success');
    } catch (err) {
      // A 409 names either the colleague holding the matter or the move the transition table needs.
      toast(err?.message || 'That request could not be taken.', 'error');
    } finally {
      busy.current = false;
    }
  };

  const shareDraft = async (payload) => {
    try {
      const updated = await shareServiceRequestDraft(detail.id, payload);
      applyUpdate(updated);
      await fileInternalNote('Draft shared');
      toast(updated?.draftCheck?.status === 'pending'
        ? 'The draft is waiting for a colleague to check it before the customer sees it.'
        : 'The draft was shared with the customer.', 'success');
    } catch (err) {
      toast(err?.message || 'The draft could not be shared.', 'error');
      throw err;
    }
  };

  const uploadFinal = async (file, registration) => {
    try {
      const updated = await uploadServiceRequestFinalDoc(detail.id, file, registration);
      applyUpdate(updated);
      await fileInternalNote('Registered copy uploaded');
      toast('The registered copy was uploaded.', 'success');
    } catch (err) {
      toast(err?.message || 'The registered copy could not be uploaded.', 'error');
      throw err;
    }
  };

  const decideDraftCheck = async (decision, note) => {
    try {
      const updated = await checkServiceRequestDraft(detail.id, decision, note);
      applyUpdate(updated);
      toast(decision === 'release' ? 'Draft released to the customer.' : 'Draft sent back to the holder.', 'success');
    } catch (err) {
      toast(err?.message || 'The draft check could not be saved.', 'error');
      throw err;
    }
  };

  const docUnavailable = () => toast('This document cannot be previewed in local development. Download or open it in the deployed environment.', 'info');

  const sendMessage = async (text) => {
    try {
      applyUpdate(await addServiceRequestMessage(detail.id, text));
    } catch (err) {
      toast(err?.message || 'The message could not be sent.', 'error');
      throw err;
    }
  };

  const cancel = async (reason) => {
    try {
      const updated = await cancelServiceRequestAsOps(detail.id, reason);
      applyUpdate(updated);
      await fileInternalNote('Cancelled');
      toast('The request was cancelled and the customer was notified.', 'success');
    } catch (err) {
      toast(err?.message || 'The request could not be cancelled.', 'error');
      throw err;
    }
  };

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const from = state.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, state.total);

  const columns = [
    {
      key: 'id',
      header: 'Request',
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.service}</div>
          <div className="text-xs text-gray-400">{r.id}</div>
        </div>
      ),
    },
    { key: 'summary', header: 'Summary', render: (r) => <span className="text-gray-300">{summaryOf(r)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'assignedTo', header: 'Held by', render: (r) => r.assignedTo || <span className="text-gray-500">Nobody</span> },
    { key: 'amount', header: 'Charged', render: (r) => (r.amount ? fmtINR(r.amount) : <span className="text-gray-500">Free desk</span>) },
    { key: 'createdAt', header: 'Opened', render: (r) => <AgeTone request={r} /> },
  ];

  const card = (r) => (
    <button type="button" onClick={() => openDetail(r)} className="dz-card block w-full p-3.5 text-left">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{r.service}</div>
          <div className="mt-0.5 truncate text-xs text-gray-400">{r.id} · {summaryOf(r)}</div>
        </div>
        <div className="shrink-0"><Badge status={r.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span>{r.assignedTo || 'Nobody'}</span>
        <span className="text-gray-600">·</span>
        <AgeTone request={r} />
      </div>
    </button>
  );

  return (
    <div>
      <PageHeader
        title={DESK_BY_VALUE[desk]?.label || 'Service requests'}
        subtitle="Live requests for this desk."
        actions={
          <button onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-ghost">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={STATUS_OPTS} className="sm:w-48" ariaLabel="Filter by status" />
        <label className="relative min-w-0 sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <span className="sr-only">Search requester name, mobile, or request id</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm"
            placeholder="Name, mobile or request id"
          />
        </label>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 px-2 text-sm text-gray-300">
          <input type="checkbox" checked={unassigned} onChange={(event) => { setUnassigned(event.target.checked); setPage(0); }} />
          Unassigned only
        </label>
        {state.status === 'ready' ? (
          <span className="text-xs text-gray-400 sm:ml-auto">
            {state.total ? `Showing ${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(state.total)}` : 'Nothing in this view'}
          </span>
        ) : null}
      </div>

      {state.status === 'loading' ? <Loading label="Loading the request queue…" /> : null}

      {state.status === 'error' ? (
        <div className="dz-card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-gray-300">
            We could not read the request queue. This is not an empty queue — nothing was loaded.
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
            onRowClick={openDetail}
            label="requests"
            empty="No service requests match these filters."
            mobileCard={card}
          />
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="dz-btn dz-btn-ghost disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-gray-400">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="dz-btn dz-btn-ghost disabled:opacity-40">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <Modal open={!!detail} onClose={closeDetail} title={detail ? `${detail.service} · ${detail.id}` : ''} size="lg">
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge status={detail.status} />
              <span className="text-gray-400">Held by {detail.assignedTo || 'nobody'}</span>
              {detail.amount ? (<><span className="text-gray-600">·</span><span className="text-gray-400">{fmtINR(detail.amount)}</span></>) : null}
              <button type="button" onClick={take} className="dz-btn dz-btn-ghost ml-auto">
                <Hand className="h-4 w-4" /> Take this request
              </button>
            </div>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {detailRows(detail.details).length === 0 ? (
                <div className="text-sm text-gray-500">This request carried no details.</div>
              ) : (
                detailRows(detail.details).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-white/5 py-1">
                    <dt className="text-gray-400">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))
              )}
            </dl>

            {/* Read-only by design: the server folds this checklist from service metadata. */}
            <DocumentChecklist
              request={detail}
              checklist={checklist}
              status={checklistStatus}
              onChange={setChecklist}
              onError={(message) => toast(message, 'error')}
            >
              <ServiceDocuments documents={detail.docs} onUnavailable={docUnavailable} />
            </DocumentChecklist>

            {detail.draftCheck?.status === 'pending' ? (
              <DraftSecondCheck request={detail} onDecide={decideDraftCheck} />
            ) : null}

            <StaffWorkflowActions request={detail} onShareDraft={shareDraft} onUploadFinal={uploadFinal} />

            <MessageThread messages={detail.messages} onSend={sendMessage} />

            <div className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Internal notes</h4>
                {detail.status !== 'cancelled' && detail.status !== 'completed' ? (
                  <button type="button" onClick={() => setCancelTarget(detail)} className="dz-btn dz-btn-ghost text-rose-200">
                    Cancel request
                  </button>
                ) : null}
              </div>
              <InternalNote
                entityType="service_request"
                entityId={detail.id}
                value={internalNote}
                onChange={setInternalNote}
                showHistory
                className="[&>button]:min-h-[44px]"
              />
            </div>

            <PartyIdentities key={`${detail.id}:${detail.assignedTo || ''}`} requestId={detail.id} />

            {(detail.timeline || []).length ? (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Timeline</h4>
                <ul className="space-y-1 text-sm">
                  {detail.timeline.map((e, i) => (
                    <li key={`${e.stage}-${i}`} className="flex justify-between gap-2 border-b border-white/5 py-1">
                      <span className="text-gray-300">{e.stage}</span>
                      <span className="text-xs text-gray-500">{e.by || '—'} · {fmtAgo(e.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <CancelDialog key={cancelTarget?.id || 'closed'} request={cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={cancel} />
    </div>
  );
}
