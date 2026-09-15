import { ExternalLink, FileText } from 'lucide-react';
import { isViewableDoc } from '../../../../../lib/openDoc.js';
import { dateLabel } from './vocabulary.js';

// Resolve local storage routes too, but never render an active data URL as a signed-file link.
function documentHref(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && isViewableDoc(url.href)
      ? url.href : null;
  } catch {
    return null;
  }
}

function DocumentLink({ file, expired }) {
  const href = expired ? null : documentHref(file?.url);
  if (!href) {
    return <span className="text-xs text-amber-200">
      {expired ? 'Link expired — refresh documents.' : 'File link unavailable — refresh documents.'}
    </span>;
  }
  // The visible text stays inside the accessible name, so "click Open original file" still matches.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      className="dz-btn dz-btn-ghost min-h-[44px] flex-shrink-0 text-teal-300"
      aria-label={file.fileName ? `Open original file — ${file.fileName}` : 'Open original file'}>
      <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open original file
    </a>
  );
}

/** The vault files on this listing. `linksExpired` withdraws links the object store has aged out. */
export default function UploadedDocuments({ documents, linksExpired }) {
  if (!documents.length) {
    return <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-sm text-gray-400">No uploaded documents. Ask the lister to upload a file before recording evidence.</p>;
  }
  return (
    <ul className="space-y-2">
      {documents.map((file) => (
        <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" aria-hidden="true" />
            <div className="min-w-0">
              <p className="break-all text-sm font-semibold text-gray-100">{file.fileName}</p>
              <p className="mt-0.5 text-xs text-gray-400">{file.category} · Uploaded {dateLabel(file.uploadedAt)}</p>
            </div>
          </div>
          <DocumentLink file={file} expired={linksExpired} />
        </li>
      ))}
    </ul>
  );
}
