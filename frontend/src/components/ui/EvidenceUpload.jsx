import Icon from '../Icon.jsx';

const MIME_RE = /^(image\/(png|jpe?g|webp|heic|heif)|application\/pdf)$/i;
const MAX_BYTES = 2 * 1024 * 1024; // keep localStorage lean — drop the data URL beyond this

// Reads an image/PDF proof to a data URL (small files) or metadata-only when too large.
// Shared by the resident-verification and society-claim flows.
export const readEvidenceDoc = (file) => new Promise((resolve) => {
  if (!file) { resolve(null); return; }
  if (!MIME_RE.test(file.type || '')) { resolve(null); return; }
  const meta = { name: file.name, size: file.size, mime: file.type };
  if ((file.size || 0) > MAX_BYTES) { resolve({ ...meta, dataUrl: null, tooLarge: true }); return; }
  const reader = new FileReader();
  reader.onload = () => resolve({ ...meta, dataUrl: reader.result });
  reader.onerror = () => resolve({ ...meta, dataUrl: null });
  reader.readAsDataURL(file);
});

/**
 * `onChange(doc, file)` — the preview object, and the original `File` beside it.
 *
 * The second argument exists because `readEvidenceDoc` is lossy on purpose: it caps the data URL at
 * 2 MB to keep localStorage lean, so a 5 MB certificate arrives as metadata with `dataUrl: null`
 * even though the vault would happily take it (its own ceiling is 10 MB). A flow that actually
 * uploads needs the bytes, and rebuilding them from the preview would inherit the smaller cap and
 * silently fail on exactly the large scans people photograph on a phone.
 *
 * It is a second argument rather than a `file` key on `doc` because two of the three callers put
 * their doc straight into a request body or a store, and a `File` in either place serialises to
 * `{}`. Callers that do not want the bytes simply keep ignoring the parameter.
 */
export default function EvidenceUpload({ doc, onChange, label = 'Upload proof (PDF or image)', ariaLabel = 'Upload proof' }) {
  const pick = (file) => {
    if (!file) return;
    readEvidenceDoc(file)
      .then((d) => onChange(d, d ? file : null))
      .catch(() => onChange(null, null));
  };
  return (
    <label className={'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition ' + (doc ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/15 bg-white/5 hover:border-violet-400/40')}>
      <input type="file" className="hidden" accept="image/*,.pdf" aria-label={ariaLabel} onChange={(e) => pick(e.target.files && e.target.files[0])} />
      <Icon name={doc ? 'file-check' : 'upload-cloud'} className="w-5 h-5 text-violet-300 flex-shrink-0" />
      <span className={'text-sm truncate ' + (doc ? 'text-violet-200' : 'text-gray-400')}>{doc ? doc.name : label}</span>
      {doc && <Icon name="shield-check" className="w-4 h-4 text-violet-300 ml-auto flex-shrink-0" />}
    </label>
  );
}
