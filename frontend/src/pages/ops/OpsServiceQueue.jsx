import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  allRequests, get, isActive, statusLabel, STEPS,
  markRead, assign, setDocStatus, markDocsVerified, shareDraft,
  submitRegistration, uploadFinal, addMessage, unread, cancel, seedDemo,
} from '../../lib/serviceFlow.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import Icon from '../../components/Icon.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtAgo } from './service-queue/helpers.js';
import { STAGE_BADGE, DOC_PILL, STAGE_OPTS } from './service-queue/constants.js';
import Stepper from './service-queue/Stepper.jsx';
import DocViewer from './service-queue/DocViewer.jsx';

/* Config-driven ops queue backed by the shared service-workflow engine
   (serviceFlow.js). Faithful port of ops-service.js — same state machine,
   same localStorage, only the nouns/rows/labels differ per team. */
export const SVC_CONFIG = {
  rental: {
    type: 'rental', title: 'Rent Agreement queue', subtitle: 'Drafting, e-stamp and doorstep delivery requests.',
    icon: 'building-2', draftNoun: 'Draft', regNoun: 'Registration', finalNoun: 'registered agreement',
    steps: ['Submitted', 'Documents', 'Draft & approval', 'Registration', 'Ready'],
    summaryKey: 'property',
    rows: [['Property', 'property'], ['Owner', 'ownerName'], ['Tenant(s)', 'tenants'], ['Monthly rent', 'rent', 'inr'], ['Deposit', 'deposit', 'inr'], ['Start date', 'startDate']],
    heroAmtKey: 'rent', heroAmtFmt: 'inr', heroAmtLabel: 'monthly rent', heroSubKey: 'property',
  },
  legal: {
    type: 'legal', title: 'Property & Legal', subtitle: 'Title checks, due-diligence & registration support',
    icon: 'scale', draftNoun: 'Legal opinion', regNoun: 'Registration', finalNoun: 'registered document',
    steps: ['Submitted', 'Documents', 'Opinion & approval', 'Registration', 'Ready'],
    summaryKey: 'property',
    rows: [['Service needed', 'service'], ['Customer role', 'role'], ['Property location', 'location'], ['Property / address', 'property'], ['Buyer', 'buyer'], ['Deal value', 'value', 'inr'], ['Area', 'area'], ['Purpose', 'purpose'], ['Customer note', 'note']],
    heroAmtKey: 'value', heroAmtFmt: 'inr', heroAmtLabel: 'deal value', heroSubKey: 'property',
  },
  interior: {
    type: 'interior', title: 'Interior & Renovation', subtitle: 'From design consult to handover',
    icon: 'paint-roller', draftNoun: 'Design quote', regNoun: 'Execution', finalNoun: 'handover photos',
    steps: ['Submitted', 'Site visit', 'Design & quote', 'Execution', 'Handover'],
    summaryKey: 'property',
    rows: [['Property', 'property'], ['Scope', 'scope'], ['Rooms', 'rooms'], ['Budget', 'budget', 'inr'], ['Timeline', 'timeline']],
    heroAmtKey: 'budget', heroAmtFmt: 'inr', heroAmtLabel: 'budget', heroSubKey: 'scope',
  },
  packers: {
    type: 'packers', title: 'Packers & Movers', subtitle: 'Survey, quote, move & delivery',
    icon: 'truck', draftNoun: 'Quote', regNoun: 'Moving day', finalNoun: 'delivery confirmation',
    steps: ['Submitted', 'Survey', 'Quote', 'Moving day', 'Delivered'],
    summaryKeys: ['from', 'to'],
    rows: [['Moving from', 'from'], ['Moving to', 'to'], ['Move date', 'moveDate'], ['Home size', 'homeSize'], ['Floors', 'floors'], ['Quote', 'quote', 'inr']],
    heroAmtKey: 'quote', heroAmtFmt: 'inr', heroAmtLabel: 'quote',
  },
  valuation: {
    type: 'valuation', title: 'Property Valuation', subtitle: 'Site visit, valuation report & delivery',
    icon: 'calculator', draftNoun: 'Valuation report', regNoun: 'Review', finalNoun: 'signed report',
    steps: ['Submitted', 'Site visit', 'Report draft', 'Review', 'Delivered'],
    summaryKey: 'property',
    rows: [['Property', 'property'], ['Property type', 'ptype'], ['Area', 'area'], ['Purpose', 'purpose'], ['Est. value', 'estValue', 'inr']],
    heroAmtKey: 'estValue', heroAmtFmt: 'inr', heroAmtLabel: 'est. value', heroSubKey: 'property',
  },
};

export default function OpsServiceQueue({ type }) {
  const svc = SVC_CONFIG[type] || SVC_CONFIG.rental;
  const { toast } = useToast();
  const { user } = useAuth();
  const me = user?.name || svc.title + ' Team';
  const fileRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [cur, setCur] = useState(null); // { mobile, id }
  const [msg, setMsg] = useState('');
  const [docView, setDocView] = useState(null); // docId of the document open in the viewer
  const [noteDraft, setNoteDraft] = useState('');
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => { seedDemo(); refresh(); }, []);

  const all = useMemo(() => allRequests(svc.type), [svc.type, tick]);

  const summaryOf = (r) => {
    const d = r.details || {};
    if (svc.summaryKeys) return svc.summaryKeys.map((k) => d[k] || '').filter(Boolean).join(' → ') || '—';
    // Fall back across common lead fields so a real (lighter) submission never shows a blank
    // summary just because the richer agent-fill key (e.g. `property`) hasn't been filled yet.
    return d[svc.summaryKey || 'property'] || d.service || d.location || d.from || '—';
  };

  const counts = useMemo(() => ({
    total: all.length,
    open: all.filter((r) => isActive(r.status)).length,
    action: all.filter((r) => ['submitted', 'docs_review', 'changes_requested', 'approved'].includes(r.status)).length,
    done: all.filter((r) => r.status === 'completed').length,
  }), [all]);

  const rows = useMemo(() => {
    const n = q.toLowerCase();
    return all.filter((r) => {
      const matchQ = !n || (`${r.customer?.name || ''} ${summaryOf(r)} ${r.id} ${r.customer?.mobile || ''}`).toLowerCase().includes(n);
      const matchS = !stage ? true
        : stage === 'open' ? isActive(r.status)
        : stage === 'action' ? ['submitted', 'docs_review', 'changes_requested', 'approved'].includes(r.status)
        : r.status === stage;
      return matchQ && matchS;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, stage]);

  const openReq = (mobile, id) => {
    markRead(mobile, id, 'staff');
    if (!get(mobile, id)?.assignedTo) assign(mobile, id, me);
    setCur({ mobile, id });
    setMsg('');
    refresh();
  };

  const fresh = () => (cur ? get(cur.mobile, cur.id) : null);

  const pickFile = (cb) => {
    const inp = fileRef.current;
    if (!inp) return;
    inp.value = '';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => cb({ fileName: f.name, dataUrl: rd.result, mime: f.type });
      rd.readAsDataURL(f);
    };
    inp.click();
  };

  const doExport = () => exportCsv(
    `punenest-${svc.type}.csv`,
    ['ID', 'Customer', 'Mobile', 'Summary', 'Stage', 'Updated', 'Assigned'],
    rows.map((r) => [r.id, r.customer?.name, r.customer?.mobile, summaryOf(r), statusLabel(r.status), new Date(r.updatedAt).toLocaleString('en-IN'), r.assignedTo || '']),
  );

  const columns = [
    { key: 'id', header: 'ID', render: (r) => <span className="text-xs text-gray-400">{r.id}</span> },
    {
      key: 'customer', header: 'Customer',
      render: (r) => (<div><div className="font-semibold">{r.customer?.name}</div><div className="text-xs text-gray-400">{r.customer?.mobile}</div></div>),
    },
    { key: 'summary', header: 'Summary', render: (r) => <span className="text-gray-300">{summaryOf(r) || '—'}</span> },
    {
      key: 'status', header: 'Stage',
      render: (r) => {
        const u = unread(r._mobile, r.id, 'staff');
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={classNames('px-2 py-0.5 rounded-md text-xs font-medium', STAGE_BADGE[r.status] || 'bg-slate-500/15 text-slate-300')}>{statusLabel(r.status)}</span>
            {u ? <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300">{u} new</span> : null}
          </span>
        );
      },
    },
    { key: 'updatedAt', header: 'Updated', render: (r) => <span className="text-xs text-gray-400">{fmtAgo(r.updatedAt)}</span> },
    { key: 'assignedTo', header: 'Assigned', render: (r) => r.assignedTo || <span className="text-gray-500">—</span> },
    { key: '_open', header: '', render: (r) => <button onClick={(e) => { e.stopPropagation(); openReq(r._mobile, r.id); }} className="pn-btn pn-btn-primary pn-btn-sm"><Icon name="folder-open" className="w-4 h-4" /> Open</button> },
  ];

  const r = fresh();
  const d = r?.details || {};
  const verifiedCount = (r?.docs || []).filter((x) => x.status === 'verified').length;
  const uploadedCount = (r?.docs || []).filter((x) => x.file && (x.file.dataUrl || x.file.tooLarge)).length;
  const heroAmt = r && svc.heroAmtKey && d[svc.heroAmtKey] != null && d[svc.heroAmtKey] !== ''
    ? (svc.heroAmtFmt === 'inr' ? fmtINR(d[svc.heroAmtKey]) : String(d[svc.heroAmtKey])) : '—';

  const kvRows = r ? [
    ['Request ID', r.id], ['Stage', statusLabel(r.status)], ['Customer', r.customer?.name], ['Mobile', r.customer?.mobile],
    ...svc.rows.map(([label, key, fmt]) => [label, fmt === 'inr' ? (d[key] ? fmtINR(d[key]) : '—') : d[key]]),
    ['Assigned to', r.assignedTo || me],
  ] : [];

  const verifyAll = () => { markDocsVerified(cur.mobile, cur.id, me); refresh(); toast('Documents verified', 'success'); };
  const doDoc = (docId, st) => { setDocStatus(cur.mobile, cur.id, docId, st); refresh(); };
  const openDocViewer = (doc) => { setDocView(doc.id); setNoteDraft(doc.note || ''); };
  const saveDocNote = () => {
    const doc = (fresh()?.docs || []).find((x) => x.id === docView);
    if (!doc) return;
    setDocStatus(cur.mobile, cur.id, docView, doc.status || 'submitted', noteDraft.trim());
    refresh();
    toast('Note saved');
  };
  const doShareDraft = () => pickFile((f) => { shareDraft(cur.mobile, cur.id, f, me); refresh(); toast('Shared with customer', 'success'); });
  const doSubmitReg = () => { submitRegistration(cur.mobile, cur.id, me); refresh(); toast('Updated', 'success'); };
  const doUploadFinal = () => pickFile((f) => { uploadFinal(cur.mobile, cur.id, f, me); refresh(); toast('Final document uploaded — customer notified', 'success'); });
  const doCancel = () => { if (!window.confirm('Cancel this request?')) return; cancel(cur.mobile, cur.id, me); setCur(null); refresh(); toast('Request cancelled'); };
  const send = () => { if (!msg.trim()) return; addMessage(cur.mobile, cur.id, 'staff', msg.trim()); setMsg(''); refresh(); };

  // Notify the customer on WhatsApp with a status-aware message (real delivery channel
  // for the maker-checker transitions: draft ready → approve, registered → download).
  const waCustomer = () => {
    const rr = fresh(); if (!rr) return;
    const phone = String(rr.customer?.mobile || cur.mobile || '').replace(/\D/g, '');
    const name = rr.customer?.name ? rr.customer.name.split(' ')[0] : 'there';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const track = origin + '/dashboard';
    let text;
    if (rr.status === 'draft_shared') text = `Hi ${name}, your ${rr.service} draft (v${rr.draft?.version || 1}) is ready to review & approve on PuneNest. Open it here: ${track}`;
    else if (rr.status === 'changes_requested') text = `Hi ${name}, thanks for your feedback on the ${rr.service} draft — we're preparing a revised version and will share it shortly.`;
    else if (rr.status === 'registration') text = `Hi ${name}, your ${rr.service} has been submitted for government e-registration. We'll message you the moment the registered copy is ready.`;
    else if (rr.status === 'completed') text = `Hi ${name}, great news — your ${rr.service} is registered and ready to download from your PuneNest dashboard: ${track}`;
    else text = `Hi ${name}, an update on your ${rr.service} request: ${statusLabel(rr.status)}. Track it anytime here: ${track}`;
    window.open(`https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" />
      <PageHeader
        title={svc.title}
        subtitle={svc.subtitle}
        actions={<button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" /> Export CSV</button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['All', counts.total, ''],
          ['Open', counts.open, 'open'],
          ['Needs action', counts.action, 'action'],
          ['Completed', counts.done, 'completed'],
        ].map(([label, count, key]) => (
          <button key={label} onClick={() => setStage(key)} aria-pressed={stage === key} className={classNames('pn-card p-4 text-left transition', stage === key ? 'border-brand-teal/40 ring-1 ring-brand-teal/30' : 'hover:bg-white/5')}>
            <div className="text-2xl font-extrabold">{fmtNum(count)}</div>
            <div className="text-xs text-gray-400">{label}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${svc.title} requests`} placeholder="Search customer, ID, summary…" className="pn-input sm:w-72" />
        <div className="sm:w-56"><Select value={stage} onChange={setStage} options={STAGE_OPTS(svc)} ariaLabel="Filter stage" /></div>
        <span className="text-xs text-gray-400">{rows.length} request(s)</span>
      </div>

      <Table columns={columns} rows={rows} onRowClick={(x) => openReq(x._mobile, x.id)} empty={`No ${svc.title} requests`} />

      <Modal
        open={!!r}
        onClose={() => setCur(null)}
        title={r ? `${svc.title} · ${r.customer?.name}` : ''}
        size="lg"
        footer={r ? (
          <>
            <button onClick={() => setCur(null)} className="pn-btn pn-btn-ghost">Close</button>
            {r.customer?.mobile ? <button type="button" onClick={waCustomer} className="pn-btn pn-btn-ghost" title="Notify customer on WhatsApp"><Icon name="message-circle" className="w-4 h-4" /> Notify on WhatsApp</button> : null}
            {isActive(r.status) ? <button onClick={doCancel} className="pn-btn pn-btn-danger"><Icon name="x-circle" className="w-4 h-4" /> Cancel request</button> : null}
          </>
        ) : null}
      >
        {r ? (
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            {/* Hero */}
            <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="min-w-0">
                <div className="text-lg font-bold text-white">{r.customer?.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={classNames('px-2 py-0.5 rounded-md text-xs font-medium', STAGE_BADGE[r.status] || 'bg-slate-500/15 text-slate-300')}>{statusLabel(r.status)}</span>
                  <span className="px-2 py-0.5 rounded-md text-xs bg-slate-500/15 text-slate-300">{r.assignedTo || 'Unassigned'}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-400"><Icon name={svc.icon} className="w-3.5 h-3.5" /> {(svc.heroSubKey && d[svc.heroSubKey]) || summaryOf(r) || '—'} · {r.id}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-extrabold gradient-text">{heroAmt}</div>
                <div className="text-[11px] text-gray-500">{svc.heroAmtLabel || ''}</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-4"><Stepper status={r.status} steps={svc.steps} /></div>

            {/* Details */}
            <div className="rounded-xl border border-white/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Icon name="clipboard-list" className="w-4 h-4 text-teal-400" /> Request details</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {kvRows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-white/5 py-1">
                    <dt className="text-gray-400">{k}</dt>
                    <dd className="text-right font-medium text-gray-200">{v == null || v === '' ? '—' : v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Documents */}
            <div className="rounded-xl border border-white/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="folder-check" className="w-4 h-4 text-teal-400" /> Documents shared by customer
                <span className="ml-auto text-xs font-semibold text-gray-400">{uploadedCount} uploaded · {verifiedCount} / {(r.docs || []).length} verified</span>
              </div>
              <div className="space-y-2">
                {(r.docs || []).length === 0 ? <p className="text-xs text-gray-500">No documents yet.</p> : (r.docs || []).map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name={x.file && /^image\//.test(x.file.mime || '') ? 'image' : 'file-text'} className="w-4 h-4 text-gray-400" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{x.name}</div>
                        <div className="truncate text-[11px] text-gray-500">{x.file ? (x.file.fileName || '') : 'No file attached'}{x.note ? ' · 📝 ' + x.note : ''}</div>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <button onClick={() => openDocViewer(x)} title="View document" className="pn-btn pn-btn-ghost pn-btn-sm"><Icon name="eye" className="w-3.5 h-3.5" /></button>
                      <span className={classNames('px-1.5 py-0.5 rounded text-[10px] font-medium', DOC_PILL[x.status] || DOC_PILL.submitted)}>{x.status === 'verified' ? 'Verified' : x.status === 'rejected' ? 'Rejected' : 'Submitted'}</span>
                      <button onClick={() => doDoc(x.id, 'verified')} title="Verify" className="rounded-md bg-emerald-500/15 p-1.5 text-emerald-300 hover:bg-emerald-500/25"><Icon name="check" className="w-3.5 h-3.5" /></button>
                      <button onClick={() => doDoc(x.id, 'rejected')} title="Reject" className="rounded-md bg-rose-500/15 p-1.5 text-rose-300 hover:bg-rose-500/25"><Icon name="x" className="w-3.5 h-3.5" /></button>
                      <button onClick={() => openDocViewer(x)} title="Add note" className="rounded-md bg-white/5 p-1.5 text-gray-300 hover:bg-white/10"><Icon name="pencil" className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
              {(r.docs || []).length ? <button onClick={verifyAll} className="pn-btn pn-btn-ghost pn-btn-sm mt-3"><Icon name="check-check" className="w-4 h-4" /> Mark all verified</button> : null}
            </div>

            {/* Draft */}
            <div className="rounded-xl border border-white/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Icon name="file-pen-line" className="w-4 h-4 text-teal-400" /> {svc.draftNoun}</div>
              {r.draft ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{svc.draftNoun} v{r.draft.version} · {r.draft.fileName}</div>
                      <div className="text-xs text-gray-500">Shared {fmtAgo(r.draft.sharedAt)}</div>
                    </div>
                    {r.draft.dataUrl ? <button onClick={() => window.open(r.draft.dataUrl, '_blank', 'noopener')} className="pn-btn pn-btn-ghost pn-btn-sm"><Icon name="download" className="w-3.5 h-3.5" /> Open {svc.draftNoun.toLowerCase()}</button> : null}
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    {r.draftDecision ? (r.draftDecision.type === 'accepted' ? <span className="text-emerald-300">Customer approved.</span> : <span className="text-rose-300">Customer requested changes{r.draftDecision.note ? ': ' + r.draftDecision.note : ''}</span>) : 'Awaiting the customer\'s decision…'}
                  </div>
                  {(r.status === 'changes_requested' || r.status === 'draft_shared') ? <button onClick={doShareDraft} className="pn-btn pn-btn-ghost pn-btn-sm mt-3"><Icon name="upload" className="w-4 h-4" /> Share a revised {svc.draftNoun.toLowerCase()}</button> : null}
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs text-gray-400">Prepare the {svc.draftNoun.toLowerCase()} and share it with the customer for review.</p>
                  <button onClick={doShareDraft} className="pn-btn pn-btn-primary pn-btn-sm"><Icon name="upload" className="w-4 h-4" /> Upload &amp; share {svc.draftNoun.toLowerCase()}</button>
                </div>
              )}
            </div>

            {/* Registration / final */}
            {r.status === 'approved' ? (
              <div className="rounded-xl border border-white/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Icon name="landmark" className="w-4 h-4 text-teal-400" /> {svc.regNoun}</div>
                <p className="mb-2 text-xs text-gray-400">The customer approved. Move it into {svc.regNoun.toLowerCase()}.</p>
                <button onClick={doSubmitReg} className="pn-btn pn-btn-primary pn-btn-sm"><Icon name="send" className="w-4 h-4" /> Submit for {svc.regNoun.toLowerCase()}</button>
              </div>
            ) : r.status === 'registration' ? (
              <div className="rounded-xl border border-white/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Icon name="landmark" className="w-4 h-4 text-teal-400" /> {svc.regNoun}</div>
                <p className="mb-2 text-xs text-gray-400">In {svc.regNoun.toLowerCase()}. Upload the {svc.finalNoun} to complete and notify the customer.</p>
                <button onClick={doUploadFinal} className="pn-btn pn-btn-success pn-btn-sm"><Icon name="file-up" className="w-4 h-4" /> Upload {svc.finalNoun}</button>
              </div>
            ) : r.status === 'completed' && r.finalDoc ? (
              <div className="rounded-xl border border-emerald-500/30 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Icon name="badge-check" className="w-4 h-4 text-emerald-400" /> Final document</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">{r.finalDoc.fileName}</div>
                  {r.finalDoc.dataUrl ? <button onClick={() => window.open(r.finalDoc.dataUrl, '_blank', 'noopener')} className="pn-btn pn-btn-ghost pn-btn-sm"><Icon name="download" className="w-3.5 h-3.5" /> Download</button> : null}
                </div>
              </div>
            ) : null}

            {/* Messages */}
            <div className="rounded-xl border border-white/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <Icon name="messages-square" className="w-4 h-4 text-teal-400" /> Messages with customer
              </div>
              <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
                {(r.messages || []).length ? (r.messages || []).map((m, i) => (
                  <div key={m.id || i} className={classNames('flex', m.from === 'staff' ? 'justify-end' : 'justify-start')}>
                    <div className={classNames('max-w-[80%] rounded-2xl px-3 py-1.5 text-xs', m.from === 'staff' ? 'bg-brand-teal/20 text-teal-100' : 'bg-white/8 text-gray-200')}>
                      {m.text}
                      <div className="mt-0.5 text-[10px] text-gray-500">{m.from === 'staff' ? 'You (PuneNest)' : r.customer?.name} · {fmtAgo(m.at)}</div>
                    </div>
                  </div>
                )) : <p className="text-center text-xs text-gray-500">No messages yet.</p>}
              </div>
              <div className="flex items-center gap-2">
                <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Message the customer…" className="pn-input flex-1" />
                <button onClick={send} className="pn-btn pn-btn-primary"><Icon name="send" className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <DocViewer
        doc={docView ? (r?.docs || []).find((x) => x.id === docView) : null}
        note={noteDraft}
        onNote={setNoteDraft}
        onSaveNote={saveDocNote}
        onClose={() => setDocView(null)}
      />
    </div>
  );
}
