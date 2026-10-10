import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../../../../context/ToastContext.jsx';
import { openDocFrom } from '../../../../../lib/openDoc.js';
import { getOwnershipDocumentUrl } from '../../../../../services/propertyReviewService.js';
import { dateLabel } from './vocabulary.js';

function DocumentLink({ propertyId, file }) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (!(await openDocFrom(() => getOwnershipDocumentUrl(propertyId, file.id)))) {
        toast('Could not open this file. Try again.', 'error');
      }
    } finally {
      setOpening(false);
    }
  };
  // The visible text stays inside the accessible name, so "click Open" still matches.
  return (
    <button type="button" onClick={open} disabled={opening}
      className="dz-btn dz-btn-ghost dz-btn-sm shrink-0 text-teal-300"
      aria-label={file.fileName ? `Open original file — ${file.fileName}` : 'Open original file'}>
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
    </button>
  );
}
/** The vault files on this listing; each Open mints its own signed link. */
export default function UploadedDocuments({ propertyId, documents }) {
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
          <DocumentLink propertyId={propertyId} file={file} />
        </li>
      ))}
    </ul>
  );
}
