import { AlertTriangle, UserCheck } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { titleCase, fmtDate, Chip, actBtn, TEAL, RED } from './helpers.jsx';

/**
 * The cross-society residency queue.
 *
 * Reads `GET /admin/society-residents` — the fourth of this console's four queues, and the last one
 * to stop reading the operator's own browser. Every verification recorded here used to be visible
 * to exactly one person: whoever clicked it.
 *
 * **The evidence column lost its two badges, and that is the migration working.** They read "OTP"
 * and the proof-document type — an `otpVerified` flag and an uploaded file that the applicant's own
 * browser had written beside the request and could therefore assert about itself. Neither ever
 * reached a server, so a reviewer was deciding on evidence that was, in the literal sense,
 * self-certified. The same two badges came off the committee's own sidebar for the same reason when
 * that screen moved. What the server holds is what the applicant typed and who they say they are in
 * the flat, so that is what this shows.
 *
 * The society is named rather than only slugged: this queue spans every building, and a row reading
 * "B/704, pending" is not a decision anybody can make. `societyName` comes from the server's join;
 * the slug is the fallback, because a visible slug is a bug an operator can report and a blank cell
 * is one they cannot.
 */
export default function ResidentsTab({ residents, decideResident, deciding }) {
  const society = (r) => r.societyName || titleCase(r.societySlug);
  const busy = (r) => !!deciding?.has(r.id);

  const evidence = (r) => (
    <div className="flex flex-wrap gap-1">
      {r.relation ? <Chip tone="bg-violet-500/15 text-violet-200" icon={<UserCheck className="h-3 w-3" />}>{titleCase(r.relation)}</Chip> : null}
      {r.flagged === 'conflict' ? <Chip tone="bg-red-500/15 text-red-200" icon={<AlertTriangle className="h-3 w-3" />}>Unit conflict</Chip> : null}
      {!r.relation && r.flagged !== 'conflict' ? <span className="text-xs text-gray-500">—</span> : null}
    </div>
  );

  const statusBadge = (r) => (
    <Badge status={r.status === 'verified' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'}>
      {r.status === 'verified' ? 'Verified' : r.status === 'rejected' ? 'Rejected' : 'Pending'}
    </Badge>
  );

  /* A decided row keeps the button for the opposite decision, because re-deciding a residency is a
     real thing an operator does: a flat changes hands, and rejecting the outgoing resident is how
     the incoming one gets verified. The server agrees — there is deliberately no already-decided
     409 on this route, unlike claims and proposals. */
  const actions = (r) => (
    <div className="flex flex-wrap gap-1">
      {r.status !== 'verified' ? actBtn('Verify', TEAL, () => decideResident(r, 'verified'), busy(r)) : null}
      {r.status !== 'rejected' ? actBtn('Reject', RED, () => decideResident(r, 'rejected'), busy(r)) : null}
    </div>
  );

  const resCols = [
    { key: 'society', header: 'Society', render: (r) => <div><div className="font-semibold">{society(r)}</div><div className="text-xs text-gray-400">{fmtDate(r.createdAt)} · {r.assignedTo === 'committee' ? 'Committee' : 'Ops'}</div></div> },
    { key: 'name', header: 'Resident', render: (r) => <div><div>{r.name || '—'}</div><div className="text-xs text-gray-400">{r.mobile || '—'}</div></div> },
    { key: 'flat', header: 'Unit', render: (r) => <div><div>{[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>{r.note ? <div className="text-xs text-gray-500 max-w-[180px] truncate" title={r.note}>{r.note}</div> : null}</div> },
    { key: 'evidence', header: 'Stated', render: evidence },
    { key: 'status', header: 'Status', render: statusBadge },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: actions },
  ];

  const resCard = (r) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{society(r)}</div>
          <div className="mt-0.5 text-xs text-gray-400">{fmtDate(r.createdAt)} · {r.assignedTo === 'committee' ? 'Committee' : 'Ops'}</div>
        </div>
        {statusBadge(r)}
      </div>
      <div className="mt-2 text-sm text-gray-200">{r.name || '—'} <span className="text-gray-500">· {r.mobile || '—'}</span></div>
      <div className="mt-0.5 text-xs text-gray-400">Unit: {[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>
      {r.note ? <div className="mt-0.5 text-xs text-gray-500">{r.note}</div> : null}
      <div className="mt-2">{evidence(r)}</div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">{actions(r)}</div>
    </div>
  );

  return (
    <Table columns={resCols} rows={residents} rowKey={(r) => r.id} pageSize={10} label="residents" empty="No resident verification requests yet." mobileCard={resCard} />
  );
}
