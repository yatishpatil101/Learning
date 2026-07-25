import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, actBtn, PLAIN } from './helpers.jsx';

export default function DirectoryTab({ directory, openEdit }) {
  const dirCols = [
    { key: 'name', header: 'Society', render: (s) => <div><div className="font-semibold">{s.name}</div><div className="text-xs text-gray-400">{s.builder} · {s.year}</div></div> },
    { key: 'locality', header: 'Locality', render: (s) => <span className="capitalize">{titleCase(s.localitySlug)}</span> },
    { key: 'verified', header: 'Verified', render: (s) => <Badge status={s.registration && s.conveyance ? 'approved' : 'pending'}>{s.registration && s.conveyance ? 'Verified' : 'Partial'}</Badge> },
    { key: 'claim', header: 'Claim', render: (s) => <Badge status={s.claimStatus === 'claimed' ? 'approved' : s.claimStatus === 'pending' ? 'pending' : 'muted'}>{s.claimStatus === 'claimed' ? 'Claimed' : s.claimStatus === 'pending' ? 'Pending' : 'Unclaimed'}</Badge> },
    { key: 'maint', header: 'Maint.', render: (s) => `₹${s.maintenancePerSqft}/sqft` },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (s) => actBtn('Edit', PLAIN, () => openEdit(s)) },
  ];

  const dirCard = (s) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{s.builder} · {s.year}</div>
        </div>
        {actBtn('Edit', PLAIN, () => openEdit(s))}
      </div>
      <div className="mt-2 text-xs text-gray-400 capitalize">{titleCase(s.localitySlug)} · ₹{s.maintenancePerSqft}/sqft</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge status={s.registration && s.conveyance ? 'approved' : 'pending'}>{s.registration && s.conveyance ? 'Verified' : 'Partial'}</Badge>
        <Badge status={s.claimStatus === 'claimed' ? 'approved' : s.claimStatus === 'pending' ? 'pending' : 'muted'}>{s.claimStatus === 'claimed' ? 'Claimed' : s.claimStatus === 'pending' ? 'Pending' : 'Unclaimed'}</Badge>
      </div>
    </div>
  );

  return (
    <Table columns={dirCols} rows={directory} rowKey={(s) => s.slug} pageSize={10} label="directory" empty="No societies." mobileCard={dirCard} />
  );
}
