import { FileText } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, fmtDate, openDoc, Chip, actBtn, TEAL, RED } from './helpers.jsx';

export default function ClaimsTab({ claims, decideClaim }) {
  const claimCols = [
    { key: 'society', header: 'Society', render: (c) => <div><div className="font-semibold">{c.society || titleCase(c.slug)}</div><div className="text-xs text-gray-400">{c.loc || '—'} · {fmtDate(c.at)}</div></div> },
    { key: 'name', header: 'Requester', render: (c) => <div><div>{c.name || '—'}</div><div className="text-xs text-gray-400">{c.role || 'Committee'}</div></div> },
    { key: 'mobile', header: 'Mobile', render: (c) => c.mobile || '—' },
    { key: 'reg', header: 'Reg / Cert', render: (c) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-gray-300">{c.regNo || '—'}</span>
        {c.cert ? <button onClick={() => openDoc(c.cert)} className="inline-flex w-fit"><Chip tone="bg-violet-500/15 text-violet-200 hover:bg-violet-500/25" icon={<FileText className="h-3 w-3" />}>{'Certificate' + (c.cert.dataUrl ? '' : ' (large)')}</Chip></button> : null}
      </div>
    ) },
    { key: 'status', header: 'Status', render: (c) => <Badge status={c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'}>{c.status === 'approved' ? 'Claimed' : c.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (c) => (
      <div className="flex flex-wrap gap-1">
        {c.status !== 'approved' ? actBtn('Approve', TEAL, () => decideClaim(c.slug, 'approved')) : null}
        {c.status !== 'rejected' ? actBtn('Reject', RED, () => decideClaim(c.slug, 'rejected')) : null}
      </div>
    ) },
  ];

  const claimCard = (c) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.society || titleCase(c.slug)}</div>
          <div className="mt-0.5 text-xs text-gray-400">{c.loc || '—'} · {fmtDate(c.at)}</div>
        </div>
        <Badge status={c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'}>{c.status === 'approved' ? 'Claimed' : c.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge>
      </div>
      <div className="mt-2 text-sm text-gray-200">{c.name || '—'} <span className="text-gray-500">· {c.role || 'Committee'}</span></div>
      <div className="mt-0.5 text-xs text-gray-400">{c.mobile || '—'} · Reg {c.regNo || '—'}</div>
      {c.cert ? <button onClick={() => openDoc(c.cert)} className="mt-2 inline-flex"><Chip tone="bg-violet-500/15 text-violet-200 hover:bg-violet-500/25" icon={<FileText className="h-3 w-3" />}>{'Certificate' + (c.cert.dataUrl ? '' : ' (large)')}</Chip></button> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {c.status !== 'approved' ? actBtn('Approve', TEAL, () => decideClaim(c.slug, 'approved')) : null}
        {c.status !== 'rejected' ? actBtn('Reject', RED, () => decideClaim(c.slug, 'rejected')) : null}
      </div>
    </div>
  );

  return (
    <Table columns={claimCols} rows={claims} rowKey={(r) => r.id} pageSize={10} label="claims" empty="No claim requests yet." mobileCard={claimCard} />
  );
}
