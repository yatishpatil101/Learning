import { useEffect, useId, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { listServiceRequestOverlaps } from '../../../services/serviceRequestService.js';

const MATCH_LABEL = { listing: 'same listing', address: 'same flat, society and pincode', record: 'filed agreement record' };
const shortId = (id) => id.slice(0, 8);
const term = (row) => (row.startDate && row.endDate ? `${row.startDate} → ${row.endDate}` : 'term not stated');

/** Other rent agreements on this flat over the same months, for the drafter to rule out first. */
export default function OverlapCheck({ request }) {
  const titleId = useId();
  const [rows, setRows] = useState(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let current = true;
    listServiceRequestOverlaps(request.id)
      .then((list) => { if (current) setRows(list); })
      .catch((err) => { if (current) setFailure(err?.message || 'Other agreements on this flat could not be checked.'); });
    return () => { current = false; };
  }, [request.id]);

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby={titleId}>
      <h4 id={titleId} className="text-sm font-semibold">Overlap check</h4>
      {failure ? <p role="alert" className="mt-2 text-sm text-amber-200">{failure}</p> : null}
      {!rows && !failure ? <p className="mt-2 text-sm text-gray-400">Checking other agreements on this flat…</p> : null}
      {rows && rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">No other paid agreement on this flat overlaps these months.</p>
      ) : null}
      {rows?.length ? (
        <>
          <p className="mt-2 flex items-start gap-2 text-sm text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Another agreement covers this flat for some of the same months. Confirm it has ended or is
            being replaced before drafting.
          </p>
          <ul className="mt-2 space-y-2">
            {rows.map((row) => (
              <li key={row.requestId} className="rounded-xl border border-white/5 p-3 text-xs text-gray-300">
                <span className="font-mono">{shortId(row.requestId)}</span> · {row.status} · {term(row)} · {MATCH_LABEL[row.match] || row.match}
                {row.licensorDiffers ? (
                  <p className="mt-1 text-amber-200">Licensor named differently there: {row.licensor}. Check who owns the flat.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
