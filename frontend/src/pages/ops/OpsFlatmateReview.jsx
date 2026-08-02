import { useMemo, useState } from 'react';
import { BadgeCheck, Check, Clock, Flag, FileText, KeyRound, ShieldCheck, X, XCircle } from 'lucide-react';
import { getFlatmateReviews, decideFlatmateReview } from '../../lib/data/flatmates.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { openDocUrl } from '../../lib/openDoc.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');
const maskMobile = (d) => { const s = String(d || ''); return s.length >= 4 ? '••••• ' + s.slice(-4) : '—'; };

// Open an uploaded agreement in a blank tab. The scheme allowlist and the
// assign-to-location dance live in lib/openDoc.js so every document surface
// (Ops queues, DocVault, dashboard) shares one rule.
const openAgreement = (dataUrl) => openDocUrl(dataUrl);

/* Ops agreement-review queue. A sitting tenant's "I have a registered rent
   agreement" is self-declared, so tenant-tier flatmate posts (and any address a
   different host already claimed) land here for Ops to verify before they earn an
   Ops-verified trust cue. Approve → the post shows Ops-verified; reject(+reason) →
   it shows the review failed and the reason is recorded. Reads/writes the same
   localStorage review store the consumer flow enqueues into. */
export default function OpsFlatmateReview() {
  const { toast } = useToast();
  const [all, setAll] = useState(() => getFlatmateReviews());
  const [tab, setTab] = useState('pending');
  const [rejecting, setRejecting] = useState(null); // review id being rejected
  const [reason, setReason] = useState('');

  const reload = () => setAll(getFlatmateReviews());

  const approve = (r) => {
    decideFlatmateReview(r.id, 'approved');
    toast('Approved — the host now shows Ops-verified', 'success');
    reload();
  };
  const startReject = (r) => { setRejecting(r.id); setReason(''); };
  const confirmReject = (r) => {
    const clean = reason.trim();
    if (!clean) { toast('Add a clear reason before rejecting', 'error'); return; }
    decideFlatmateReview(r.id, 'rejected', clean);
    toast('Rejected — the host is told why', 'error');
    setRejecting(null);
    reload();
  };

  const stats = useMemo(() => ({
    pending: all.filter((r) => r.status === 'pending').length,
    flagged: all.filter((r) => r.flagForReview && r.status === 'pending').length,
    approved: all.filter((r) => r.status === 'approved').length,
    rejected: all.filter((r) => r.status === 'rejected').length,
  }), [all]);

  const rows = useMemo(() => {
    if (tab === 'pending') return all.filter((r) => r.status === 'pending');
    if (tab === 'flagged') return all.filter((r) => r.flagForReview && r.status === 'pending');
    if (tab === 'approved') return all.filter((r) => r.status === 'approved');
    if (tab === 'rejected') return all.filter((r) => r.status === 'rejected');
    return all;
  }, [all, tab]);

  const STAT_TILES = [
    { label: 'Pending', value: stats.pending, icon: Clock, tab: 'pending' },
    { label: 'Flagged', value: stats.flagged, icon: Flag, tab: 'flagged' },
    { label: 'Ops-verified', value: stats.approved, icon: BadgeCheck, tab: 'approved' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, tab: 'rejected' },
  ];
  const TABS = [['pending', 'Pending', stats.pending], ['flagged', 'Flagged', stats.flagged], ['approved', 'Ops-verified', stats.approved], ['rejected', 'Rejected', stats.rejected], ['all', 'All', all.length]];

  return (
    <div>
      <PageHeader title="Flatmate Verification" subtitle="Verify tenant replacement claims before they earn seekers' trust." />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_TILES.map((s) => (
          <div key={s.label} onClick={() => setTab(s.tab)} className={classNames('pn-card p-4 cursor-pointer hover:bg-white/5')}>
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{s.label}</div><div className="mt-1 text-2xl font-extrabold">{fmtNum(s.value)}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><s.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-teal/25 bg-brand-teal/5 p-4 text-sm text-gray-300">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" />
        <div>A tenant replacement listing is <b className="text-gray-200">Aadhaar-identity verified</b> already. Ops confirms the <b className="text-gray-200">registered rent agreement</b> (and, when present, that <b className="text-gray-200">owner consent</b> was captured) before it earns an <b className="text-gray-200">Ops-verified</b> badge. <b className="text-gray-200">Flagged</b> rows are addresses another host already claimed.</div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-max">
        {TABS.map(([id, label, count]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('rounded-lg px-3 py-1.5 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:bg-white/5')}>
            {label} <span className="opacity-70">({fmtNum(count)})</span>
          </button>
        ))}
      </div>

      <div className="pn-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs font-semibold text-gray-400">
              <th className="p-3">Host</th><th className="p-3">Flat / address</th><th className="p-3">Claim</th><th className="p-3">Signals</th><th className="p-3">Status</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-white/5 align-top">
                <td className="p-3"><div className="font-semibold">{r.host || '—'}</div><div className="text-xs text-gray-400">{maskMobile(r.hostMobile)}</div><div className="text-[11px] text-gray-500">{fmtDate(r.createdAt)}</div></td>
                <td className="p-3 max-w-xs text-gray-300"><div>{r.address || '—'}</div>{r.kind && <span className="mt-1 inline-block rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">{r.kind === 'room' ? 'Room' : 'Group'}</span>}</td>
                <td className="p-3"><span className="inline-flex items-center gap-1 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-1.5 py-0.5 text-[11px] capitalize text-brand-teal"><KeyRound className="h-3 w-3" />{r.tier}-tier</span></td>
                <td className="p-3">
                  <div className="flex max-w-xs flex-wrap gap-1">
                    {r.agreementDoc && r.agreementDoc.dataUrl ? (
                      <button type="button" onClick={() => openAgreement(r.agreementDoc.dataUrl)} className="view-agreement-btn inline-flex items-center gap-1 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-1.5 py-0.5 text-[10px] text-brand-teal"><FileText className="h-2.5 w-2.5" />View agreement</button>
                    ) : r.agreementDoc ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400"><FileText className="h-2.5 w-2.5" />Agreement on file</span>
                    ) : r.tier === 'tenant' ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"><X className="h-2.5 w-2.5" />No document</span>
                    ) : null}
                    {r.ownerConsent && <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300"><Check className="h-2.5 w-2.5" />Owner consent</span>}
                    {r.flagForReview && <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"><Flag className="h-2.5 w-2.5" />Contested address</span>}
                    {!r.agreementDoc && r.tier !== 'tenant' && !r.ownerConsent && !r.flagForReview && <span className="text-[11px] text-gray-500">—</span>}
                  </div>
                </td>
                <td className="p-3"><Badge status={r.status} />{r.status === 'rejected' && r.reason ? <div className="mt-1 max-w-[12rem] text-[11px] text-rose-300">{r.reason}</div> : null}</td>
                <td className="p-3">
                  {r.status === 'pending' ? (
                    rejecting === r.id ? (
                      <div className="flex flex-col gap-1.5 w-52">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-200" />
                        <div className="flex gap-1">
                          <button onClick={() => confirmReject(r)} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300"><Check className="h-3 w-3" />Confirm</button>
                          <button onClick={() => { setRejecting(null); setReason(''); }} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><X className="h-3 w-3" />Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => approve(r)} className="approve-review-btn inline-flex items-center gap-1 rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal"><Check className="h-3 w-3" />Approve</button>
                        <button onClick={() => startReject(r)} className="reject-review-btn inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><X className="h-3 w-3" />Reject</button>
                      </div>
                    )
                  ) : <span className="text-xs text-gray-500">—</span>}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="p-10 text-center text-sm text-gray-500">No flatmate reviews here 🛏️</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
