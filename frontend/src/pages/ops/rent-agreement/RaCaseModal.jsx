import { useEffect, useState } from 'react';
import { Check, Hand } from 'lucide-react';
import {
  addServiceRequestMessage, cancelServiceRequestAsOps, checkServiceRequestDraft, getServiceRequest, readServiceRequestChecklist,
  shareServiceRequestDraft, takeServiceRequest, uploadServiceRequestFinalDoc,
} from '../../../services/serviceRequestService.js';
import { classNames, fmtINR } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Loading from '../../../components/ui/Loading.jsx';
import InternalNote, { saveNoteIfAny } from '../../../components/ui/InternalNote.jsx';
import AgeTone from '../service-queue/AgeTone.jsx';
import AmendTerms from '../service-queue/AmendTerms.jsx';
import CancelDialog from '../service-queue/CancelDialog.jsx';
import DraftSecondCheck from '../service-queue/DraftSecondCheck.jsx';
import MessageThread from '../service-queue/MessageThread.jsx';
import OverlapCheck from '../service-queue/OverlapCheck.jsx';
import PartyIdentities from '../service-queue/PartyIdentities.jsx';
import PoliceIntimation from '../service-queue/PoliceIntimation.jsx';
import Refunds from '../service-queue/Refunds.jsx';
import RegistrationCheck from '../service-queue/RegistrationCheck.jsx';
import StaffWorkflowActions from '../service-queue/StaffWorkflowActions.jsx';
import { fmtAgo } from '../service-queue/helpers.js';
import CaseParticulars from './CaseParticulars.jsx';
import { STAGES, caseSummary, nextStep, stagesDone } from './stages.js';

const card = 'rounded-xl border border-white/10 bg-black/10 p-4';
const CLOSED = new Set(['completed', 'cancelled']);
const PRE_DRAFT = new Set(['submitted', 'docs_review', 'changes_requested']);
const NEXT_TONE = {
  desk: 'border-brand-teal/40 bg-brand-teal/10 text-teal-100',
  customer: 'border-white/10 bg-white/5 text-gray-300',
  colleague: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  done: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
};
const NEXT_WHO = { desk: 'Your move', customer: "Customer's move", colleague: 'Colleague check', done: 'Closed' };

/** One rent agreement case: everything to read on the left, every action in the rail on the right. */
export default function RaCaseModal({ request, nextId, onNext, onClose, onChanged }) {
  const s = request ? caseSummary(request.details) : null;
  const footer = (
    <>
      <button type="button" onClick={onNext} disabled={!nextId} className="dz-btn dz-btn-ghost mr-auto">Next case</button>
      <button type="button" onClick={onClose} className="dz-btn dz-btn-primary">Close</button>
    </>
  );
  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title={s ? `${s.owner || 'Owner'} → ${s.tenants || 'Tenant'}` : ''}
      size="xl"
      footer={footer}
    >
      {request ? <CaseBody key={request.id} id={request.id} onChanged={onChanged} /> : null}
    </Modal>
  );
}

/** A queue row is a summary, so the full case is read once when it opens and refreshed by the desk's own actions. */
function CaseBody({ id, onChanged }) {
  const [initial, setInitial] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getServiceRequest(id)
      .then((res) => { if (live) { if (res) setInitial(res); else setFailed(true); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  if (failed) return <p role="alert" className="p-4 text-sm text-gray-300">This case could not be opened. Close it and try again.</p>;
  if (!initial) return <Loading label="Opening the case…" />;
  return <CaseView initial={initial} onChanged={onChanged} />;
}

function CaseView({ initial, onChanged }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState(initial);
  const [checklist, setChecklist] = useState(null);
  const [checklistStatus, setChecklistStatus] = useState('loading');
  const [internalNote, setInternalNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    let live = true;
    readServiceRequestChecklist(detail.id)
      .then((res) => { if (live) { setChecklist(res); setChecklistStatus('ready'); } })
      // Not an empty list: that would tell the desk the customer sent nothing.
      .catch(() => { if (live) setChecklistStatus('error'); });
    return () => { live = false; };
  }, [detail.id]);

  const s = caseSummary(detail.details);
  const done = stagesDone(detail, checklist);
  const next = nextStep(detail, checklistStatus === 'ready' ? checklist : null);
  const closed = CLOSED.has(detail.status);
  const toastError = (message) => toast(message, 'error');
  const docUnavailable = () => toast('This document cannot be previewed in local development. Download or open it in the deployed environment.', 'info');

  const applyUpdate = (updated) => {
    if (!updated) return;
    setDetail(updated);
    onChanged();
  };

  const fileNote = async (action) => {
    const result = await saveNoteIfAny('service_request', detail.id, internalNote, action);
    if (result.error) toast('The case changed, but the internal note was not saved.', 'error');
    if (result.written) setInternalNote('');
  };

  /** Runs one desk action; the server's sentence is the toast on failure, and the rethrow keeps the form's input. */
  const act = (fn, success, note) => async (...args) => {
    try {
      applyUpdate(await fn(detail.id, ...args));
      if (note) await fileNote(note);
      if (success) toast(typeof success === 'function' ? success(args) : success, 'success');
    } catch (err) {
      toastError(err?.message || 'That did not go through.');
      throw err;
    }
  };

  const take = async () => {
    if (taking) return;
    setTaking(true);
    try {
      await act(takeServiceRequest, 'This case is now yours. The customer can see the change.')();
    } catch {
      // Toasted by `act`; a 409 names the colleague holding it.
    } finally {
      setTaking(false);
    }
  };

  const shareDraft = act(async (id, payload) => {
    const updated = await shareServiceRequestDraft(id, payload);
    toast(updated?.draftCheck?.status === 'pending'
      ? 'The draft is waiting for a colleague to check it before the customer sees it.'
      : 'The draft was shared with the customer.', 'success');
    return updated;
  }, null, 'Draft shared');
  const uploadFinal = act(uploadServiceRequestFinalDoc, 'The registered copy was uploaded.', 'Registered copy uploaded');
  const decideDraftCheck = act(checkServiceRequestDraft, ([decision]) => (decision === 'release' ? 'Draft released to the customer.' : 'Draft sent back to the holder.'));
  const sendMessage = act(addServiceRequestMessage);
  const cancel = act(cancelServiceRequestAsOps, 'The case was cancelled and the customer was notified.', 'Cancelled');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <Badge status={detail.status} />
          <AgeTone request={detail} />
          <span>· {s.flat || 'Flat not given'}{s.locality ? `, ${s.locality}` : ''}</span>
          {detail.amount ? <span>· Paid {fmtINR(detail.amount)}</span> : null}
          <span className="text-xs text-gray-500">· {detail.id}</span>
        </div>

        <ol aria-label="Case stages" className="flex gap-1 overflow-x-auto pb-1">
          {STAGES.map((label, i) => {
            const state = detail.status === 'cancelled' ? 'todo' : i < done ? 'done' : i === done ? 'current' : 'todo';
            return (
              <li
                key={label}
                aria-current={state === 'current' ? 'step' : undefined}
                className={classNames(
                  'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                  state === 'done' && 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
                  state === 'current' && 'border-brand-teal/50 bg-brand-teal/15 font-semibold text-white',
                  state === 'todo' && 'border-white/10 text-gray-500',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                {label}
              </li>
            );
          })}
        </ol>

        <CaseParticulars
          request={detail}
          checklist={checklist}
          status={checklistStatus}
          onChecklist={setChecklist}
          onError={toastError}
          onUnavailable={docUnavailable}
        >
          <PartyIdentities key={`${detail.id}:${detail.assignedTo || ''}:${closed}`} requestId={detail.id} className={card} />
        </CaseParticulars>

        {PRE_DRAFT.has(detail.status) ? <OverlapCheck key={`overlap-${detail.id}`} request={detail} /> : null}

        {detail.draft ? <DraftStatus request={detail} /> : null}

        {detail.status === 'completed' ? (
          <RegistrationCheck key={`reg-${detail.id}`} request={detail} onError={toastError} onUnavailable={docUnavailable} />
        ) : null}

        <AmendTerms key={`amend-${detail.id}`} request={detail} onUpdated={applyUpdate} />
        {detail.amount > 0 ? <Refunds key={`refunds-${detail.id}`} request={detail} /> : null}

        <MessageThread messages={detail.messages} onSend={sendMessage} />

        {detail.timeline?.length ? (
          <details className={card}>
            <summary className="cursor-pointer text-sm font-semibold">Timeline ({detail.timeline.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.timeline.map((e, i) => (
                <li key={`${e.stage}-${i}`} className="flex justify-between gap-2 border-b border-white/5 py-1 last:border-0">
                  <span className="text-gray-300">{e.stage}</span>
                  <span className="text-xs text-gray-500">{e.by || '—'} · {fmtAgo(e.at)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <div className={classNames('rounded-xl border p-4', NEXT_TONE[next.who])} data-testid="ra-next-step">
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">{NEXT_WHO[next.who]}</div>
          <p className="mt-1 text-sm font-medium">{next.text}</p>
        </div>

        <div className={card}>
          <div className="text-xs text-gray-400">Held by</div>
          <div className="mt-0.5 text-sm font-semibold">{detail.assignedToMe ? 'You' : detail.assignedTo || 'Nobody yet'}</div>
          {!closed && !detail.assignedToMe ? (
            <button type="button" onClick={take} disabled={taking} className="dz-btn dz-btn-primary mt-3 w-full disabled:opacity-40">
              <Hand className="h-4 w-4" /> {taking ? 'Taking…' : 'Take case'}
            </button>
          ) : null}
        </div>

        {detail.draftCheck?.status === 'pending' ? <DraftSecondCheck request={detail} onDecide={decideDraftCheck} /> : null}

        <StaffWorkflowActions request={detail} onShareDraft={shareDraft} onUploadFinal={uploadFinal} />

        {detail.status === 'completed' ? (
          <PoliceIntimation key={`police-${detail.id}`} request={detail} onUpdated={applyUpdate} onError={toastError} />
        ) : null}

        <div className={card}>
          <h4 className="text-sm font-semibold">Internal note</h4>
          <InternalNote
            entityType="service_request"
            entityId={detail.id}
            value={internalNote}
            onChange={setInternalNote}
            showHistory
            className="[&>button]:min-h-[44px]"
          />
          {!closed ? (
            <button type="button" onClick={() => setCancelOpen(true)} className="dz-btn dz-btn-ghost mt-3 w-full text-rose-200">
              Cancel request
            </button>
          ) : null}
        </div>
      </aside>

      <CancelDialog key={cancelOpen ? 'open' : 'closed'} request={cancelOpen ? detail : null} onClose={() => setCancelOpen(false)} onConfirm={cancel} />
    </div>
  );
}

function DraftStatus({ request }) {
  const { draft, draftApproval } = request;
  return (
    <section className={card} aria-label="Draft and approvals">
      <h4 className="text-sm font-semibold">Draft &amp; approvals</h4>
      <p className="mt-1 text-xs text-gray-400">
        Version {draft.version} · shared {fmtAgo(draft.sharedAt)} · {draft.opened ? 'opened by the customer' : 'not opened yet'}
      </p>
      {draftApproval?.parties?.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {draftApproval.parties.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-2">
              <span className="text-gray-300">{p.label}</span>
              <span className={p.approved ? 'text-emerald-300' : p.opened ? 'text-amber-200' : 'text-gray-500'}>
                {p.approved ? 'Approved' : p.opened ? 'Opened' : 'Not opened'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
