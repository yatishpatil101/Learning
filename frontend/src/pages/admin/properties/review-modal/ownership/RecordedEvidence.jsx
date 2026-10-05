import { classNames } from '../../../../../lib/format.js';
import { dateLabel, docTypeLabel } from './vocabulary.js';

const maskLast4 = (value) => {
  const last = String(value ?? '').replace(/\s+/g, '').slice(-4);
  return last ? `•••• ${last}` : '';
};
const IDENTITY = ['aadhaar', 'pan'];

/** What has already been checked and logged against this case. */
export default function RecordedEvidence({ evidence, documents }) {
  if (!evidence.length) return <p className="text-sm text-gray-500">No evidence recorded.</p>;
  return (
    <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10">
      {evidence.map((row) => {
        const file = documents.find((doc) => doc.id === row.documentId)?.fileName
          || (row.documentId ? 'Linked file no longer available' : 'Offline evidence, no vault file');
        const extra = IDENTITY.includes(row.docType) ? [] : [
          row.subjectName ? `Subject: ${row.subjectName}` : null,
          row.documentNumber ? `No. ${maskLast4(row.documentNumber)}` : null,
        ];
        return (
          <li key={row.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">{docTypeLabel(row.docType, row.kind)}</p>
              <span className={classNames('shrink-0 rounded-full border px-2 py-px text-[11px] font-semibold', row.current
                ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                : 'border-rose-400/30 bg-rose-500/15 text-rose-300')}>{row.current ? 'Current' : 'Expired'}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500" title={file}>
              {[`Issued ${dateLabel(row.issuedAt)}`, row.expiresAt ? `expires ${dateLabel(row.expiresAt)}` : 'no expiry', ...extra, file].filter(Boolean).join(' · ')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
