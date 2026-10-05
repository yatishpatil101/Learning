import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Badge from '../../../components/ui/Badge.jsx';
import { classNames, fmtNum } from '../../../lib/format.js';
import {
  CHIP, CHIP_TONE, Cell, Chips, ClearFilters, FactRow, PageNav, QueuePanel, RowCard, RowList, SearchBox, useClientPaging,
} from '../../../components/admin/WorkQueue.jsx';
import { titleCase, fmtDate, actBtn, TEAL, RED } from './helpers.jsx';

const STATUS = [['', 'All'], ['pending', 'Pending'], ['verified', 'Verified'], ['rejected', 'Rejected']];

/** No OTP or proof-document evidence: those flags are self-certified by the applicant's browser.
 * The society is named because the queue spans every building. */
export default function ResidentsTab({ residents, decideResident, deciding, note }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const society = (r) => r.societyName || titleCase(r.societySlug);
  const busy = (r) => !!deciding?.has(r.id);
  const statusOf = (r) => (r.status === 'verified' || r.status === 'rejected' ? r.status : 'pending');

  const needle = q.trim().toLowerCase();
  const rows = residents.filter((r) => (!status || statusOf(r) === status)
    && (!needle || [society(r), r.name, r.mobile, r.wing, r.flat].join(' ').toLowerCase().includes(needle)));
  const page = useClientPaging(rows, 10, `${status}|${q}`);
  const chips = STATUS.map(([value, label]) => ({ value, label: `${label} ${fmtNum(value ? residents.filter((r) => statusOf(r) === value).length : residents.length)}` }));

  return (
    <QueuePanel
      active="residents"
      note={note}
      toolbar={(
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Society, name, mobile or flat" label="Search residents" />
          <Chips label="Status" options={chips} value={status} onChange={setStatus} />
          {status || q ? <ClearFilters onClick={() => { setStatus(''); setQ(''); }} /> : null}
          <div className="ml-auto"><PageNav {...page.paging} /></div>
        </>
      )}
      footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
    >
      <RowList isEmpty={!rows.length} empty={status || q ? 'No requests match these filters.' : 'No resident verification requests yet.'}>
        {page.items.map((r) => (
          <RowCard
            key={r.id}
            id={r.id}
            title={society(r)}
            badges={(
              <>
                <Badge status={statusOf(r) === 'verified' ? 'approved' : statusOf(r)}>{statusOf(r) === 'verified' ? 'Verified' : statusOf(r) === 'rejected' ? 'Rejected' : 'Pending'}</Badge>
                {r.flagged === 'conflict' ? <span className={classNames(CHIP, CHIP_TONE.red, 'gap-0.5')}><AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />Unit conflict</span> : null}
              </>
            )}
            meta={<><span>Filed {fmtDate(r.createdAt)}</span><span className="text-gray-600" aria-hidden="true">·</span><span>{r.assignedTo === 'committee' ? 'Committee' : 'Ops'}</span></>}
            facts={(
              <>
                <FactRow label="Resident">
                  <Cell className="font-medium text-gray-200">{r.name}</Cell>
                  <Cell className="tabular-nums">{r.mobile}</Cell>
                  <Cell>{[r.wing, r.flat].filter(Boolean).join(' · ')}</Cell>
                  <Cell>{r.relation ? titleCase(r.relation) : ''}</Cell>
                </FactRow>
                {r.note ? (
                  <FactRow label="Note">
                    <span className="col-span-2 text-gray-300 md:col-span-4">{r.note}</span>
                  </FactRow>
                ) : null}
              </>
            )}
            primary={(
              <>
                {/* Decided rows keep the opposite action: a flat changes hands, so rejecting the outgoing
                    resident verifies the incoming one. */}
                {r.status !== 'verified' ? actBtn('Verify', TEAL, () => decideResident(r, 'verified'), busy(r)) : null}
                {r.status !== 'rejected' ? actBtn('Reject', RED, () => decideResident(r, 'rejected'), busy(r)) : null}
              </>
            )}
          />
        ))}
      </RowList>
    </QueuePanel>
  );
}
