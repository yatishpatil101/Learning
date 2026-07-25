import { Check, FileText, AlertTriangle } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, fmtDate, openDoc, Chip, actBtn, PROOF_LABELS, TEAL, RED } from './helpers.jsx';

export default function ResidentsTab({ residents, decideResident }) {
  const resCols = [
    { key: 'society', header: 'Society', render: (r) => <div><div className="font-semibold">{titleCase(r.slug)}</div><div className="text-xs text-gray-400">{fmtDate(r.at)} · {r.assignedTo === 'committee' ? 'Committee' : 'Ops'}</div></div> },
    { key: 'name', header: 'Resident', render: (r) => <div><div>{r.name || '—'}</div><div className="text-xs text-gray-400">{r.mobile || '—'}</div></div> },
    { key: 'flat', header: 'Unit', render: (r) => <div><div>{[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>{r.note ? <div className="text-xs text-gray-500 max-w-[180px] truncate" title={r.note}>{r.note}</div> : null}</div> },
    { key: 'evidence', header: 'Evidence', render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.otpVerified ? <Chip tone="bg-emerald-500/15 text-emerald-200" icon={<Check className="h-3 w-3" />}>OTP</Chip> : <Chip tone="bg-white/10 text-gray-400">No OTP</Chip>}
        {r.doc ? <button onClick={() => openDoc(r.doc)} className="inline-flex"><Chip tone="bg-violet-500/15 text-violet-200 hover:bg-violet-500/25" icon={<FileText className="h-3 w-3" />}>{(PROOF_LABELS[r.proofType] || 'Doc') + (r.doc.dataUrl ? '' : ' (large)')}</Chip></button> : <Chip tone="bg-white/10 text-gray-400">No doc</Chip>}
        {r.flagged === 'conflict' ? <Chip tone="bg-red-500/15 text-red-200" icon={<AlertTriangle className="h-3 w-3" />}>Unit conflict</Chip> : null}
      </div>
    ) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status === 'verified' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}>{r.status === 'verified' ? 'Verified' : r.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.status !== 'verified' ? actBtn('Verify', TEAL, () => decideResident(r, 'verified')) : null}
        {r.status !== 'rejected' ? actBtn('Reject', RED, () => decideResident(r, 'rejected')) : null}
      </div>
    ) },
  ];

  const resCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{titleCase(r.slug)}</div>
          <div className="mt-0.5 text-xs text-gray-400">{fmtDate(r.at)} · {r.assignedTo === 'committee' ? 'Committee' : 'Ops'}</div>
        </div>
        <Badge status={r.status === 'verified' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}>{r.status === 'verified' ? 'Verified' : r.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge>
      </div>
      <div className="mt-2 text-sm text-gray-200">{r.name || '—'} <span className="text-gray-500">· {r.mobile || '—'}</span></div>
      <div className="mt-0.5 text-xs text-gray-400">Unit: {[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>
      {r.note ? <div className="mt-0.5 text-xs text-gray-500">{r.note}</div> : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {r.otpVerified ? <Chip tone="bg-emerald-500/15 text-emerald-200" icon={<Check className="h-3 w-3" />}>OTP</Chip> : <Chip tone="bg-white/10 text-gray-400">No OTP</Chip>}
        {r.doc ? <button onClick={() => openDoc(r.doc)} className="inline-flex"><Chip tone="bg-violet-500/15 text-violet-200 hover:bg-violet-500/25" icon={<FileText className="h-3 w-3" />}>{(PROOF_LABELS[r.proofType] || 'Doc') + (r.doc.dataUrl ? '' : ' (large)')}</Chip></button> : <Chip tone="bg-white/10 text-gray-400">No doc</Chip>}
        {r.flagged === 'conflict' ? <Chip tone="bg-red-500/15 text-red-200" icon={<AlertTriangle className="h-3 w-3" />}>Unit conflict</Chip> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {r.status !== 'verified' ? actBtn('Verify', TEAL, () => decideResident(r, 'verified')) : null}
        {r.status !== 'rejected' ? actBtn('Reject', RED, () => decideResident(r, 'rejected')) : null}
      </div>
    </div>
  );

  return (
    <Table columns={resCols} rows={residents} rowKey={(r) => r.id} pageSize={10} label="residents" empty="No resident verification requests yet." mobileCard={resCard} />
  );
}
