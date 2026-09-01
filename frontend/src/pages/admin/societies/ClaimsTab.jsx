import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, fmtDate, actBtn, TEAL, RED } from './helpers.jsx';

/**
 * The committee claim queue.
 *
 * This used to render a "Reg / Cert" column — a registration number and a scanned certificate that
 * the claim form collected straight into localStorage. `SocietyClaimRequest` declares neither, so
 * against the real API the column could only ever have been empty, and an empty proof column on a
 * screen whose whole job is checking proof is worse than no column: it reads as "this claimant
 * supplied nothing" rather than "we never asked". The claimant's own `note` takes its place, which
 * is the field the contract does carry and the only free text the operator gets. Re-adding proof
 * upload is a backend change — a field on the claim request and somewhere to put the file — not a
 * frontend one. `loc` went the same way: the queue shows the society's name, not its address.
 */
export default function ClaimsTab({ claims, decideClaim, deciding }) {
  /*
   * A claim is decided once. Re-deciding rewrites `decidedBy`/`decidedAt` — losing the record of
   * who handed the building over — and re-approving a rejected claim would pass the residency
   * register to someone an operator had already turned down, so the server answers 409. Offering
   * the button and then showing that error is a worse way to say "no" than not offering it, so a
   * decided row shows when it was decided instead. The buttons also disable while their own PATCH
   * is in flight: a second click on a queue screen is routine, and the retry would 409 against the
   * decision the first click just made.
   */
  const decisionCell = (c) => {
    if (c.status !== 'pending') {
      return <span className="text-xs text-gray-500">Decided {fmtDate(c.decidedAt)}</span>;
    }
    const busy = Boolean(deciding && deciding.has(c.id));
    return (
      <>
        {actBtn('Approve', TEAL, () => decideClaim(c.id, 'approved'), busy)}
        {actBtn('Reject', RED, () => decideClaim(c.id, 'rejected'), busy)}
      </>
    );
  };

  const statusBadge = (c) => <Badge status={c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'}>{c.status === 'approved' ? 'Claimed' : c.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge>;

  const claimCols = [
    { key: 'society', header: 'Society', render: (c) => <div><div className="font-semibold">{c.societyName || titleCase(c.societySlug)}</div><div className="text-xs text-gray-400">{fmtDate(c.createdAt)}</div></div> },
    { key: 'name', header: 'Requester', render: (c) => <div><div>{c.claimantName || '—'}</div><div className="text-xs text-gray-400">{c.role || 'Committee'}</div></div> },
    { key: 'mobile', header: 'Contact', render: (c) => <div><div>{c.claimantMobile || '—'}</div><div className="text-xs text-gray-400">{c.email || '—'}</div></div> },
    { key: 'note', header: 'Note', render: (c) => <span className="text-xs text-gray-300">{c.note || '—'}</span> },
    { key: 'status', header: 'Status', render: (c) => statusBadge(c) },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (c) => (
      <div className="flex flex-wrap gap-1">
        {decisionCell(c)}
      </div>
    ) },
  ];

  const claimCard = (c) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.societyName || titleCase(c.societySlug)}</div>
          <div className="mt-0.5 text-xs text-gray-400">{fmtDate(c.createdAt)}</div>
        </div>
        {statusBadge(c)}
      </div>
      <div className="mt-2 text-sm text-gray-200">{c.claimantName || '—'} <span className="text-gray-500">· {c.role || 'Committee'}</span></div>
      <div className="mt-0.5 text-xs text-gray-400">{c.claimantMobile || '—'} · {c.email || '—'}</div>
      {c.note ? <div className="mt-2 text-xs text-gray-300">{c.note}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {decisionCell(c)}
      </div>
    </div>
  );

  return (
    <Table columns={claimCols} rows={claims} rowKey={(r) => r.id} pageSize={10} label="claims" empty="No claim requests yet." mobileCard={claimCard} />
  );
}
