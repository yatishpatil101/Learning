import { classNames } from '../../../../../lib/format.js';
import { DOC_TYPES, dateLabel } from './vocabulary.js';

/** What has already been checked and logged against this case. */
export default function RecordedEvidence({ evidence, documents }) {
  if (!evidence.length) {
    return <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-sm text-gray-400">No evidence recorded.</p>;
  }
  return (
    <ul className="space-y-2">
      {evidence.map((row) => (
        <li key={row.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-100">{DOC_TYPES.find((type) => type.value === row.docType)?.label || row.kind}</p>
            <span className={classNames('rounded-full border px-2 py-0.5 text-[11px] font-semibold', row.current
              ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
              : 'border-rose-400/30 bg-rose-500/15 text-rose-300')}>{row.current ? 'Current' : 'Expired'}</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Issued {dateLabel(row.issuedAt)} · {row.expiresAt ? `Expires ${dateLabel(row.expiresAt)}` : 'No expiry'}
            {row.subjectName ? ` · Subject: ${row.subjectName}` : ''}
          </p>
          <p className="mt-0.5 break-all text-xs text-gray-500">{documents.find((file) => file.id === row.documentId)?.fileName
            || (row.documentId ? 'Linked file is no longer available' : 'No vault file linked (offline evidence)')}</p>
        </li>
      ))}
    </ul>
  );
}
