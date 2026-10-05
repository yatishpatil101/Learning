import { useState } from 'react';
import Badge from '../../../components/ui/Badge.jsx';
import { fmtNum } from '../../../lib/format.js';
import {
  Cell, Chips, ClearFilters, FactRow, PageNav, QueuePanel, RowCard, RowList, SearchBox, useClientPaging,
} from '../../../components/admin/WorkQueue.jsx';
import { titleCase, fmtDate, actBtn, TEAL, RED, PLAIN } from './helpers.jsx';

const STATUS = [['', 'All'], ['pending', 'Pending'], ['approved', 'Claimed'], ['rejected', 'Rejected']];

/** The registration number has its own row so it stays searchable and does not displace the note.
 * The certificate is fetched from the claim on click: no staff route dereferences a vault document id. */
export default function ClaimsTab({ claims, decideClaim, deciding, viewCertificate, opening, note }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const needle = q.trim().toLowerCase();
  const rows = claims.filter((c) => (!status || c.status === status)
    && (!needle || [c.societyName, c.societySlug, c.claimantName, c.claimantMobile, c.email, c.registrationNo].join(' ').toLowerCase().includes(needle)));
  const page = useClientPaging(rows, 10, `${status}|${q}`);
  const chips = STATUS.map(([value, label]) => ({ value, label: `${label} ${fmtNum(value ? claims.filter((c) => c.status === value).length : claims.length)}` }));

  /* Decided once: re-deciding would overwrite `decidedBy`/`decidedAt`, so the server answers 409.
     Buttons disable in flight so a retry cannot 409 against the first click. */
  const decision = (c) => {
    if (c.status !== 'pending') return <span className="text-xs text-gray-500">Decided {fmtDate(c.decidedAt)}</span>;
    const busy = Boolean(deciding && deciding.has(c.id));
    return (
      <>
        {actBtn('Approve', TEAL, () => decideClaim(c.id, 'approved'), busy)}
        {actBtn('Reject', RED, () => decideClaim(c.id, 'rejected'), busy)}
      </>
    );
  };

  /* Shown only when the claim has proof; kept on decided rows as the evidence behind the decision. */
  const certificate = (c) => {
    if (!c.certificateDocumentId) return null;
    const busy = Boolean(opening && opening.has(c.id));
    return actBtn(busy ? 'Opening…' : 'Certificate', PLAIN, () => viewCertificate(c.id), busy);
  };

  const statusBadge = (c) => (
    <Badge status={c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'}>
      {c.status === 'approved' ? 'Claimed' : c.status === 'rejected' ? 'Rejected' : 'Pending'}
    </Badge>
  );

  return (
    <QueuePanel
      active="claims"
      note={note}
      toolbar={(
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Society, name, mobile or reg. no." label="Search claims" />
          <Chips label="Status" options={chips} value={status} onChange={setStatus} />
          {status || q ? <ClearFilters onClick={() => { setStatus(''); setQ(''); }} /> : null}
          <div className="ml-auto"><PageNav {...page.paging} /></div>
        </>
      )}
      footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
    >
      <RowList isEmpty={!rows.length} empty={status || q ? 'No claims match these filters.' : 'No claim requests yet.'}>
        {page.items.map((c) => (
          <RowCard
            key={c.id}
            id={c.id}
            title={c.societyName || titleCase(c.societySlug)}
            badges={(
              <>
                {statusBadge(c)}
                {c.certificateDocumentId ? null : <span className="text-[11px] text-amber-300">No certificate</span>}
              </>
            )}
            meta={<><span>Filed {fmtDate(c.createdAt)}</span><span className="text-gray-600" aria-hidden="true">·</span><span>{c.role || 'Committee'}</span></>}
            facts={(
              <>
                <FactRow label="Claimant">
                  <Cell className="font-medium text-gray-200">{c.claimantName}</Cell>
                  <Cell className="tabular-nums">{c.claimantMobile}</Cell>
                  {c.email && <Cell className="md:col-span-2">{c.email}</Cell>}
                </FactRow>
                <FactRow label="Reg. no.">
                  <Cell className="font-mono md:col-span-4">{c.registrationNo}</Cell>
                </FactRow>
                {c.note ? (
                  <FactRow label="Note">
                    <span className="col-span-2 text-gray-300 md:col-span-4">{c.note}</span>
                  </FactRow>
                ) : null}
              </>
            )}
            primary={(
              <>
                {certificate(c)}
                {decision(c)}
              </>
            )}
          />
        ))}
      </RowList>
    </QueuePanel>
  );
}
