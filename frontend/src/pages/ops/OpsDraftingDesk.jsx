import { useCallback, useEffect, useRef, useState } from 'react';
import { Hand, RefreshCw } from 'lucide-react';
import {
  addServiceRequestMessage, cancelServiceRequestAsOps, getServiceRequest, getServiceRequestQueueSummary,
  readServiceRequestChecklist, shareServiceRequestDraft,
  takeServiceRequest, uploadServiceRequestFinalDoc, checkServiceRequestDraft,
} from '../../services/serviceRequestService.js';
import { classNames, fmtINR } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { DESK_BY_VALUE } from '../../lib/adminModules.js';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import InternalNote, { saveNoteIfAny } from '../../components/ui/InternalNote.jsx';
import {
  BTN, CHIP, CHIP_TONE, Cell, FactRow, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox,
} from '../../components/admin/WorkQueue.jsx';
import AdminServices from '../admin/AdminServices.jsx';
import useDeskTickets from '../admin/useDeskTickets.js';
import AgeTone from './service-queue/AgeTone.jsx';
import CancelDialog from './service-queue/CancelDialog.jsx';
import MessageThread from './service-queue/MessageThread.jsx';
import DocumentChecklist from './service-queue/DocumentChecklist.jsx';
import ServiceDocuments from './service-queue/ServiceDocuments.jsx';
import StaffWorkflowActions from './service-queue/StaffWorkflowActions.jsx';
import DraftSecondCheck from './service-queue/DraftSecondCheck.jsx';
import PartyIdentities from './service-queue/PartyIdentities.jsx';
import { OverdueToggle, stageTabs, useQueue } from './service-queue/deskQueue.jsx';
import { fmtAgo } from './service-queue/helpers.js';

const PAGE_SIZE = 20;
const TABS = stageTabs('request');
const TAB_KEYS = TABS.map((t) => t.key);

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

const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/** One service desk's queue (legal, interior, packers, valuation). Rent agreements have their own
 *  case view in `rent-agreement/`; home loans are tickets on `AdminServices`. */
export default function OpsDraftingDesk({ desk }) {
  const { toast } = useToast();
  const [tab, setTab] = useTabParam(TAB_KEYS, 'pickup');
  const [q, setQ] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [pageTab, setPageTab] = useState(tab);
  if (pageTab !== tab) {
    setPageTab(tab);
    setPage(1);
  }

  // `null` on failure, so a tab count is omitted rather than reading "0".
  const [summary, setSummary] = useState(null);
  const tickets = useDeskTickets(summary?.openTickets);
  const summarySeq = useRef(0);
  const loadSummary = useCallback(() => {
    const seq = ++summarySeq.current;
    const settle = (value) => { if (seq === summarySeq.current) setSummary(value); };
    getServiceRequestQueueSummary(desk).then(settle, () => settle(null));
  }, [desk]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => { loadSummary(); setReloadToken((n) => n + 1); };

  const active = TABS.find((t) => t.key === tab);
  const queue = useQueue({
    type: desk, ...active.query, overdue: overdue || undefined, q: q.trim() || undefined, page: page - 1, size: PAGE_SIZE,
  }, reloadToken);
  const rows = queue.page?.items || [];
  const total = queue.page?.total ?? 0;
  const paging = { page, pageCount: Math.ceil(total / PAGE_SIZE), total, size: PAGE_SIZE, onPage: setPage, stale: queue.stale };

  const [target, setTarget] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [checklist, setChecklist] = useState(null);
  const [checklistStatus, setChecklistStatus] = useState('idle');
  const [internalNote, setInternalNote] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const busy = useRef(false);

  const targetId = target?.id || null;
  useEffect(() => {
    if (!targetId) return undefined;
    let live = true;
    setDetail(null);
    setDetailFailed(false);
    getServiceRequest(targetId)
      .then((res) => { if (live) { if (res) setDetail(res); else setDetailFailed(true); } })
      .catch(() => { if (live) setDetailFailed(true); });
    return () => { live = false; };
  }, [targetId]);

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
    setTarget(null);
    setDetail(null);
    setInternalNote('');
  };

  const openDetail = (row) => {
    setInternalNote('');
    setTarget(row);
  };

  // The open request is held as an object, so a change that moves it to another tab leaves the modal put.
  const applyUpdate = (updated) => {
    if (!updated) return;
    setDetail((d) => (d?.id === updated.id ? updated : d));
    reload();
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

  const holder = (r) => (r.assignedToMe ? 'You' : r.assignedTo || 'Nobody');

  return (
    <div>
      <PageHeader
        title={DESK_BY_VALUE[desk]?.label || 'Service requests'}
        subtitle="Live requests for this desk."
        actions={
          <button type="button" onClick={reload} className="dz-btn dz-btn-ghost">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <QueueTabs
        label="Request queues"
        active={tickets?.on ? 'tickets' : tab}
        onChange={(key) => (key === 'tickets' ? tickets.show() : setTab(key))}
        tabs={[
          ...TABS.map((t) => ({ key: t.key, label: t.label, count: summary ? t.count(summary) : null })),
          ...(tickets ? [tickets.tab] : []),
        ]}
      />

      {tickets?.on ? <AdminServices desk={desk} embedded /> : (
        <QueuePanel
          active={tab}
          toolbar={(
            <>
              <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, mobile or request id" label="Search name, mobile or request id" className="w-full sm:w-72" />
              <OverdueToggle on={overdue} count={summary?.overdue} onToggle={() => { setOverdue((v) => !v); setPage(1); }} />
              <div className="ml-auto"><PageNav {...paging} /></div>
            </>
          )}
          footer={paging.pageCount > 1 ? <PageNav {...paging} /> : null}
        >
          <div aria-busy={queue.stale || undefined} className={queue.stale ? 'pointer-events-none select-none opacity-50' : undefined}>
            {queue.failed && !queue.stale ? (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <p className="text-sm text-gray-300">
                  We could not read the request queue. This is not an empty queue — nothing was loaded.
                </p>
                <button type="button" onClick={reload} className="dz-btn dz-btn-primary">
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
              </div>
            ) : queue.page == null ? <Loading label="Loading the request queue…" /> : (
              <RowList isEmpty={!rows.length} empty={q.trim() || overdue ? 'No requests match these filters.' : active.empty}>
                {rows.map((r) => (
                  <RowCard
                    key={r.id}
                    id={r.id}
                    title={r.service}
                    badges={<><Badge status={r.status} />{r.assignedToMe ? <span className={classNames(CHIP, CHIP_TONE.teal)}>Yours</span> : null}</>}
                    meta={<><span>{detailRows(r.details)[0]?.[1] || '—'}</span><Dot /><AgeTone request={r} /></>}
                    facts={(
                      <FactRow label="Held by">
                        <Cell className={r.assignedTo ? undefined : 'text-gray-500'}>{holder(r)}</Cell>
                        <Cell>{r.amount ? `${fmtINR(r.amount)} charged` : 'Free desk'}</Cell>
                      </FactRow>
                    )}
                    primary={(
                      <button type="button" onClick={() => openDetail(r)} className={r.assignedTo && !r.assignedToMe ? BTN.ghost : BTN.primary}>
                        Open
                      </button>
                    )}
                  />
                ))}
              </RowList>
            )}
          </div>
        </QueuePanel>
      )}

      <Modal open={!!target} onClose={closeDetail} title={target ? `${target.service} · ${target.id}` : ''} size="lg">
        {!detail ? (
          detailFailed
            ? <p role="alert" className="p-4 text-sm text-gray-300">This request could not be opened. Close it and try again.</p>
            : <Loading label="Opening the request…" />
        ) : (
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
              <ServiceDocuments requestId={detail.id} documents={detail.docs} onUnavailable={docUnavailable} />
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
        )}
      </Modal>
      <CancelDialog key={cancelTarget?.id || 'closed'} request={cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={cancel} />
    </div>
  );
}
