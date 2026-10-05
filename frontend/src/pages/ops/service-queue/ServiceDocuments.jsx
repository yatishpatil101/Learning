import { ExternalLink, FileText } from 'lucide-react';
import { openDocUrl } from '../../../lib/openDoc.js';
import { fmtAgo } from './helpers.js';

const CATEGORY_LABEL = { draft: 'Draft', 'final-document': 'Registered copy' };

export default function ServiceDocuments({
  documents, onUnavailable, title = 'Files on this request', labels = {}, className = 'mt-3 border-t border-white/5 pt-3',
}) {
  if (!documents?.length) return null;
  return (
    <div className={className}>
      {title ? <h5 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{title}</h5> : null}
      <ul className="space-y-1">
        {documents.map((document) => (
          <li key={document.id || `${document.category}-${document.fileName}`}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-sky-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
              onClick={() => {
                if (!openDocUrl(document.url)) onUnavailable();
              }}
            >
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{document.fileName}</span>
              <span className="shrink-0 text-xs text-gray-400">
                {labels[document.category] || CATEGORY_LABEL[document.category] || document.category}
                {document.uploadedAt ? ` · ${fmtAgo(document.uploadedAt)}` : ''}
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
