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
    return <span className="shrink-0 text-xs text-amber-200">{expired ? 'Link expired — refresh' : 'Link unavailable — refresh'}</span>;
  }
  // The visible text stays inside the accessible name, so "click Open" still matches.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      className="dz-btn dz-btn-ghost dz-btn-sm shrink-0 text-teal-300"
      aria-label={file.fileName ? `Open original file — ${file.fileName}` : 'Open original file'}>
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
    </a>
  );
}

/** The vault files on this listing. `linksExpired` withdraws links the object store has aged out. */
export default function UploadedDocuments({ documents, linksExpired }) {
  if (!documents.length) {
    return <p className="text-sm text-gray-500">Nothing in the owner's document vault yet.</p>;
  }
  return (
    <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10">
      {documents.map((file) => (
        <li key={file.id} className="flex items-center gap-3 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-100" title={file.fileName}>{file.fileName}</p>
            <p className="text-xs text-gray-500">{file.category} · {dateLabel(file.uploadedAt)}</p>
          </div>
          <DocumentLink file={file} expired={linksExpired} />
        </li>
      ))}
    </ul>
  );
}
