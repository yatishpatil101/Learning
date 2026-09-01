import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Hand, Minus, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  listServiceRequestQueue, readServiceRequestChecklist, readServiceRequestIdentities,
  takeServiceRequest,
} from '../../services/serviceRequestService.js';
import { classNames, fmtINR, fmtNum } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { fmtAgo } from './service-queue/helpers.js';

/**
 * The drafting desk (D173) — the ops half of the identity-disclosure design (D151).
 *
 * `GET /service-requests/{id}/identities` refuses everyone but the request's assignee, audits both
 * outcomes, and had a full test suite and no caller. This is the caller.
 *
 * **It replaced `OpsServiceQueue` rather than sitting beside it.** That screen — and the five
 * one-line team wrappers over it (`/ops/legal`, `/ops/rent-agreement`, `/ops/interior`,
 * `/ops/packers`, `/ops/valuation`) — read a browser-local demo workflow, with ids that existed
 * only in the operator's own browser. Once consumers filed through the seam those five desks went
 * blind: the work landed in Postgres and the desks were still reading the browser. They could not
 * simply be pointed at the seam either, because two of their five steps are states the contract
 * refused by name — see the `docs_review` / `registration` discussion in `ServiceRequestStatus`.
 * So the old URLs now redirect here with `?type=` set, and this screen does exactly the three things
 * the server lets a desk do without a document-upload surface: read the queue, take a matter, and
 * read the numbers for the matter it has taken. It does
 * not pretend to share drafts or upload registered copies, because those are multipart uploads to a
 * vault whose signed URLs do not resolve in dev — the old desk only appeared to, into `localStorage`.
 *
 * ## What makes the reveal safe, and the four rules that come with it
 *
 * The route's guarantee is "only the assigned operator, and every access recorded". None of that
 * survives a careless client, so:
 *
 *   1. **The numbers live in component state and nowhere else.** No `localStorage`, no context, no
 *      module-level cache. Closing the panel or moving to another matter clears them, because a
 *      time-boxed disclosure that outlives the view is not time-boxed.
 *   2. **Never a list column.** The queue is a page of many matters; the numbers are one matter at
 *      a time or nothing, which is why the contract gave them their own route keyed on a single id.
 *   3. **Never in the URL.** A query string is history, a referer header and a shoulder-surfable
 *      address bar. The open request's id is not a route param here for the same reason the reveal
 *      is a button rather than an auto-load: the read is an act, and it is audited as one. (`?type=`
 *      is in the URL and does not breach this: a desk name is not a disclosure.)
 *   4. **Never logged.** No `console` call in this file touches the result.
 *
 * **A refusal is rendered, not swallowed.** The server's two sentences say *why* — nobody holds
 * this matter, or somebody else does — and they are the difference between "take it" and "go and
 * ask the person who has it". An empty list in their place would tell the desk the customer never
 * supplied numbers it is in fact being denied.
 *
 * **Taking a matter is the whole access-control story.** There is no "assign to somebody else":
 * moving to `assigned` takes the request for the caller, which costs two visible moves when
 * somebody else holds it and writes a timeline entry the customer can read plus an audit row. The
 * button says so, because a control the operator does not know they crossed is not accountability.
 *
 * ## `details` is never dumped
 *
 * `ServiceRequest.details` is free-form `jsonb` the customer's form filled, and the rent-agreement
 * wizard puts a whole redacted form snapshot in `_state` — which keeps identity numbers out but
 * keeps *mobile numbers* in. Rendering the object verbatim would put an owner's raw mobile on an
 * ops screen by accident, so the summary reads a short allow-list of named scalar fields and
 * ignores everything else. New keys are invisible here until someone adds them on purpose, which is
 * the safe direction for a field nobody controls the shape of.
 */

const PAGE_SIZE = 20;

const TYPE_OPTS = [
  { value: '', label: 'All desks' },
  { value: 'rental', label: 'Rent Agreement' },
  { value: 'legal', label: 'Property & Legal' },
  { value: 'interior', label: 'Interior & Renovation' },
  { value: 'packers', label: 'Packers & Movers' },
  { value: 'valuation', label: 'Property Valuation' },
];

/* `ServiceRequestStatus` in full, in transition order — this filter is sent as `?status=`, and the
   server is the only thing that defines these. `awaiting-payment` (a paid desk before the payment
   lands) and `changes-requested` (the customer sent a shared draft back) are both real states a
   matter sits in and both were missing here, so a desk filtering for them saw an empty queue. */
const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'awaiting-payment', label: 'Awaiting payment' },
  { value: 'new', label: 'New' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'draft-shared', label: 'Draft shared' },
  { value: 'changes-requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * The only `details` keys this screen will render, and what to call them.
 *
 * An allow-list rather than a deny-list: `details` is whatever a form put there, so anything not
 * named here is skipped — including `_state`, the wizard's full form snapshot, which carries the
 * parties' mobile numbers.
 *
 * ## Live only, on purpose (D184)
 *
 * The status filter sends `?status=` in the server's vocabulary. The former browser workflow used
 * the stepper's (`docs_review`, …), so most filters matched nothing and a desk looked idle when it
 * was not. A translation table was rejected — a mapping that exists only to make a demo look right
 * is a second vocabulary to keep in sync. The browser workflow is gone instead.
 *
 * That leaves one vocabulary, `ServiceRequestStatus`, and `STATUS_OPTS` below is all nine of
 * its values rather than the seven that happened to be reachable through the demo flow.
 */
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

const PARTY_LABEL = { owner: 'Owner', tenant: 'Tenant' };

export default function OpsDraftingDesk() {
  const { toast } = useToast();
  /* `?type=` is the desk selector, and it lives in the URL rather than in state alone so that the
     five retired team desks (`/ops/legal`, `/ops/packers`, …) can redirect here and still land an
     operator on their own work. Unrecognised values are dropped rather than sent — the server
     would reject them, and a filter nobody chose is worse than no filter. */
  const [params, setParams] = useSearchParams();

  /* Those five routes were behind `TeamRoute`, which bounced a Rental staffer off `/ops/legal`
     with a reason. The server never relied on it — `ServiceDeskAuthority.deskFilterFor` scopes a
     staff caller to their own desk and ignores a `team` they do not own (D44) — so dropping the
     guard widens nothing. It would, though, leave a staffer able to *pick* another desk and get an
     empty table back, which is the one thing this screen exists to avoid: an empty queue and a
     forbidden queue must not look alike. So staff get their own desk and nothing else to choose;
     admins, who really can see every desk, keep the full list. */
  const { team, role } = useAuth();
  /* A team with no request type of its own (loans) falls through to the full list rather than an
     empty picker; the server scopes it to nothing either way, so this only affects what is on
     screen while that is true. */
  const myDesk = TYPE_OPTS.filter((o) => o.value === team);
  const typeOpts = role === 'admin' || myDesk.length === 0 ? TYPE_OPTS : myDesk;
  const urlType = params.get('type') || '';
  const fallback = typeOpts.length === 1 ? typeOpts[0].value : '';
  const type = typeOpts.some((o) => o.value === urlType) ? urlType : fallback;
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [state, setState] = useState(() => ({ status: 'loading', items: [], total: 0 }));
  const [nonce, setNonce] = useState(0);

  const [detail, setDetail] = useState(null);
  /* The disclosure itself. Component state, cleared whenever the panel closes or the matter
     changes — see rule 1 in the header. `refusal` holds the server's own sentence. */
  const [identities, setIdentities] = useState(null);
  const [identityStatus, setIdentityStatus] = useState('idle');
  const [refusal, setRefusal] = useState('');
  /* The document checklist (D120). Unlike the identity reveal this needs no gesture and no gate:
     it carries no personal data — the names of the papers a request asks for, and whether each has
     arrived — so it loads with the matter. `null` is "not read yet", never "nothing filed". */
  const [checklist, setChecklist] = useState(null);
  const [checklistStatus, setChecklistStatus] = useState('idle');
  const busy = useRef(false);

  const load = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    listServiceRequestQueue({ type: type || undefined, status: status || undefined, page, size: PAGE_SIZE })
      .then((res) => { if (live) setState({ status: 'ready', items: res.items, total: res.total }); })
      // Never `[]`: an unread queue that renders as an empty one is how a desk goes home early.
      .catch(() => { if (live) setState({ status: 'error', items: [], total: 0 }); })
      .finally(() => {});
    return () => { live = false; };
  }, [type, status, page]);

  useEffect(load, [load, nonce]);

  /* Keyed on the id rather than the object: `take` replaces `detail` with the server's updated copy,
     and re-fetching the paperwork because somebody claimed the matter would be a request for an
     answer that cannot have changed. */
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
    setIdentities(null);
    setIdentityStatus('idle');
    setRefusal('');
  };

  const openDetail = (row) => {
    // Clear before showing the next matter, so a reveal can never be read against the wrong request.
    setIdentities(null);
    setIdentityStatus('idle');
    setRefusal('');
    setDetail(row);
  };

  const take = async () => {
    if (!detail || busy.current) return;
    busy.current = true;
    try {
      const updated = await takeServiceRequest(detail.id);
      if (updated) {
        setDetail(updated);
        setState((s) => ({ ...s, items: s.items.map((r) => (r.id === updated.id ? updated : r)) }));
      }
      // Taking a matter invalidates a refusal that was about not holding it.
      setRefusal('');
      toast('This request is now yours. The customer can see the change.', 'success');
    } catch (err) {
      // A 409 here is the transition table talking (there is no `assigned → assigned` edge), and it
      // says what move is needed. Show it rather than a generic failure.
      toast(err?.message || 'That request could not be taken.', 'error');
    } finally {
      busy.current = false;
    }
  };

  const reveal = async () => {
    if (!detail || identityStatus === 'loading') return;
    setIdentityStatus('loading');
    setRefusal('');
    try {
      setIdentities(await readServiceRequestIdentities(detail.id));
      setIdentityStatus('ready');
    } catch (err) {
      setIdentities(null);
      setIdentityStatus('refused');
      setRefusal(err?.message || 'These numbers are visible only to the person working the matter.');
    }
  };

  const hide = () => {
    setIdentities(null);
    setIdentityStatus('idle');
    setRefusal('');
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
    { key: 'createdAt', header: 'Opened', render: (r) => fmtAgo(r.createdAt) || '—' },
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
        <span>{fmtAgo(r.createdAt)}</span>
      </div>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Drafting desk"
        subtitle="The live service-request queue, and the parties' identity numbers for a matter you hold."
        actions={
          <button onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-ghost">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {/* An `offline` state stood here, for the case where `serviceRequest` was left out of the
          domain allow-list: the seeded browser workflow spoke the stepper's statuses, not the
          server's, so filtering it would have returned nothing and an empty desk is
          indistinguishable from a finished one. There is no allow-list and no seeded workflow now,
          so the desk always reads the server and reports what it says. */}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={type}
          onChange={(v) => {
            /* `replace` so the browser Back button leaves the desk instead of walking the
               operator back through every filter they tried. */
            setParams(v ? { type: v } : {}, { replace: true });
            setPage(0);
          }}
          options={typeOpts}
          className="sm:w-56"
          ariaLabel="Filter by desk"
        />
        <Select value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={STATUS_OPTS} className="sm:w-48" ariaLabel="Filter by status" />
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

            {/* The paperwork this request asks for. Read-only by design: the server folds this from
                the request's own vault documents at read time (D120), so there is no item state to
                tick and no way for this panel to disagree with what was actually filed. The only
                thing that moves an item is an upload. */}
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Documents</h4>
                {checklistStatus === 'ready' ? (
                  <span className="text-sm text-gray-400">{fmtNum(checklist.ready)} of {fmtNum(checklist.total)} received</span>
                ) : null}
              </div>

              {checklistStatus === 'loading' ? (
                <p className="mt-3 text-sm text-gray-500">Checking what has been filed…</p>
              ) : null}

              {checklistStatus === 'error' ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {/* Deliberately not "no documents": we do not know that, and saying it would send
                      somebody chasing paperwork the customer has already sent. */}
                  <span>The document list could not be read, so this is not a list of what is missing. Try again before asking the customer for anything.</span>
                </div>
              ) : null}

              {checklistStatus === 'ready' ? (
                <ul className="mt-3 space-y-1.5">
                  {checklist.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 border-b border-white/5 py-1 text-sm last:border-0">
                      {it.done ? (
                        <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Minus className="h-4 w-4 shrink-0 text-gray-600" aria-hidden="true" />
                      )}
                      <span className={classNames('flex-1', it.done ? 'text-gray-200' : 'text-gray-500')}>{it.name}</span>
                      {/* The state is on the row, but a screen reader should not have to infer it
                          from an icon that is hidden from it. */}
                      <span className="sr-only">{it.done ? 'received' : 'not received'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {checklistStatus === 'ready' && checklist.ready < checklist.total ? (
                <p className="mt-3 text-xs text-gray-400">
                  Missing items are the customer&rsquo;s to upload — there is nothing to mark here.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Parties&rsquo; identity numbers</h4>
                <div className="flex items-center gap-2">
                  <button onClick={take} className="dz-btn dz-btn-ghost">
                    <Hand className="h-4 w-4" /> Take this request
                  </button>
                  {identityStatus === 'ready' ? (
                    <button onClick={hide} className="dz-btn dz-btn-ghost">
                      <EyeOff className="h-4 w-4" /> Hide
                    </button>
                  ) : (
                    <button onClick={reveal} disabled={identityStatus === 'loading'} className="dz-btn dz-btn-primary disabled:opacity-40">
                      <Eye className="h-4 w-4" /> {identityStatus === 'loading' ? 'Checking…' : 'Reveal'}
                    </button>
                  )}
                </div>
              </div>

              <p className="mt-2 text-xs text-gray-400">
                Only the person holding this matter can read these, and every attempt — allowed or
                refused — is recorded against your name. They are discarded when the request is
                completed or cancelled.
              </p>

              {identityStatus === 'refused' ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{refusal}</span>
                </div>
              ) : null}

              {identityStatus === 'ready' ? (
                identities.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">
                    Nothing was recorded against this request. Ask the customer to add the parties&rsquo;
                    details before drafting.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {identities.map((p) => (
                      <li key={`${p.partyRole}-${p.partyIndex}`} className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-semibold">{p.partyName || `${PARTY_LABEL[p.partyRole] || 'Party'} ${p.partyIndex + 1}`}</span>
                          <span className="text-xs uppercase tracking-wide text-gray-500">{PARTY_LABEL[p.partyRole] || p.partyRole}</span>
                        </div>
                        {/* A blank number means two different things, and the reader has to be able
                            to tell them apart — the customer left it empty, or the matter closed and
                            it was discarded. `purged` is what distinguishes them. */}
                        {p.purged ? (
                          <div className="mt-1 text-xs text-gray-500">
                            Recorded, and since discarded — this request has closed.
                          </div>
                        ) : (
                          <dl className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                            <div className="flex justify-between gap-2 py-0.5">
                              <dt className="text-gray-400">PAN</dt>
                              <dd className={classNames('font-mono', p.pan ? '' : 'text-gray-500')}>{p.pan || 'not supplied'}</dd>
                            </div>
                            <div className="flex justify-between gap-2 py-0.5">
                              <dt className="text-gray-400">Aadhaar</dt>
                              <dd className={classNames('font-mono', p.aadhaar ? '' : 'text-gray-500')}>{p.aadhaar || 'not supplied'}</dd>
                            </div>
                          </dl>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>

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
    </div>
  );
}
