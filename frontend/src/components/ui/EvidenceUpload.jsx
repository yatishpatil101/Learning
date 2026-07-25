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

export default function EvidenceUpload({ doc, onChange, label = 'Upload proof (PDF or image)', ariaLabel = 'Upload proof' }) {
  const pick = (file) => { if (file) readEvidenceDoc(file).then(onChange).catch(() => onChange(null)); };
  return (
    <label className={'flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition ' + (doc ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/15 bg-white/5 hover:border-violet-400/40')}>
      <input type="file" className="hidden" accept="image/*,.pdf" aria-label={ariaLabel} onChange={(e) => pick(e.target.files && e.target.files[0])} />
      <Icon name={doc ? 'file-check' : 'upload-cloud'} className="w-5 h-5 text-violet-300 flex-shrink-0" />
      <span className={'text-sm truncate ' + (doc ? 'text-violet-200' : 'text-gray-400')}>{doc ? doc.name : label}</span>
      {doc && <Icon name="shield-check" className="w-4 h-4 text-violet-300 ml-auto flex-shrink-0" />}
    </label>
  );
}
