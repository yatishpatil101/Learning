import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, fmtDate, actBtn, TEAL, RED, PLAIN } from './helpers.jsx';

/**
 * The committee claim queue.
 *
 * The registration number is back, and it is a real column again rather than the one it had before.
 * It used to be collected straight into localStorage alongside a scanned certificate, so against
 * the real API the pair could only ever have rendered empty — and an empty proof column on a screen
 * whose whole job is checking proof is worse than no column: it reads as "this claimant supplied
 * nothing" rather than "we never asked". V109 gave the number a field of its own, so it is asked
 * for and shown. It is deliberately not folded into the note: it was briefly concatenated there as
 * "Registration no. …", which cost the reviewer the claimant's actual words and made the number
 * prose rather than something searchable.
 *
 * The certificate is here too now, as a button rather than a column. The claim carries a
 * `certificateDocumentId`, but that id is useless printed: it names a file in the claimant's own
 * personal vault, which is the same place their Aadhaar and their salary slips live. So there is
 * deliberately no staff route that dereferences a document id — the link is fetched from the
 * *claim*, on click, and the server reads the id off the row and re-checks it belongs to the person
 * who filed it. Fetching it for every row on load would mint twenty expiring capabilities per page
 * view to serve the one an operator actually opens. `loc` went the other way for its own reason:
 * the queue shows the society's name, not its address.
 */
export default function ClaimsTab({ claims, decideClaim, deciding, viewCertificate, opening }) {
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

  /*
   * Rendered only when the claim actually has one. An always-present button that answers 404 half
   * the time trains a reviewer to ignore it; absence is the honest way to say "this committee did
   * not attach proof", which is itself something the reviewer needs to weigh.
   *
   * The button stays available on decided rows. A decision is final, but the evidence behind it is
   * exactly what somebody re-reads when the decision is questioned later.
   */
  const certCell = (c) => {
    if (!c.certificateDocumentId) return null;
    const busy = Boolean(opening && opening.has(c.id));
    return actBtn(busy ? 'Opening…' : 'Certificate', PLAIN, () => viewCertificate(c.id), busy);
  };

  const claimCols = [
    { key: 'society', header: 'Society', render: (c) => <div><div className="font-semibold">{c.societyName || titleCase(c.societySlug)}</div><div className="text-xs text-gray-400">{fmtDate(c.createdAt)}</div></div> },
    { key: 'name', header: 'Requester', render: (c) => <div><div>{c.claimantName || '—'}</div><div className="text-xs text-gray-400">{c.role || 'Committee'}</div></div> },
    { key: 'mobile', header: 'Contact', render: (c) => <div><div>{c.claimantMobile || '—'}</div><div className="text-xs text-gray-400">{c.email || '—'}</div></div> },
    { key: 'note', header: 'Note', render: (c) => <div><div className="text-xs text-gray-300">{c.note || '—'}</div>{c.registrationNo ? <div className="mt-0.5 font-mono text-[11px] text-gray-400">Reg. {c.registrationNo}</div> : null}</div> },
    { key: 'status', header: 'Status', render: (c) => statusBadge(c) },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (c) => (
      <div className="flex flex-wrap gap-1">
        {certCell(c)}
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
      {c.registrationNo ? <div className="mt-1 font-mono text-[11px] text-gray-400">Reg. {c.registrationNo}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {certCell(c)}
        {decisionCell(c)}
      </div>
    </div>
  );

  return (
    <Table columns={claimCols} rows={claims} rowKey={(r) => r.id} pageSize={10} label="claims" empty="No claim requests yet." mobileCard={claimCard} />
  );
}
