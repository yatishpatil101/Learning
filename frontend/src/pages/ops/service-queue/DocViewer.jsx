import Icon from '../../../components/Icon.jsx';
import Modal from '../../../components/ui/Modal.jsx';

export default function DocViewer({ doc, note, onNote, onSaveNote, onClose }) {
  const f = doc?.file;
  const isImg = f && f.dataUrl && /^image\//.test(f.mime || '');
  const isPdf = f && f.dataUrl && (/pdf/.test(f.mime || '') || /\.pdf$/i.test(f.fileName || ''));
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      title={doc?.name || 'Document'}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="pn-btn pn-btn-ghost">Close</button>
          {f && f.dataUrl ? (
            <a href={f.dataUrl} download={f.fileName || 'document'} className="pn-btn pn-btn-ghost"><Icon name="download" className="w-4 h-4" /> Download</a>
          ) : null}
        </>
      }
    >
      {doc ? (
        <div className="space-y-4">
          {f && f.fileName ? <div className="text-xs text-gray-400">{f.fileName}</div> : null}
          <div className="rounded-xl border border-white/10 bg-black/20 p-2">
            {isImg ? (
              <img src={f.dataUrl} alt={doc.name} className="mx-auto block max-h-[60vh] max-w-full rounded-lg bg-white" />
            ) : isPdf ? (
              <iframe src={f.dataUrl} title={doc.name} className="h-[60vh] w-full rounded-lg border-0 bg-white" />
            ) : f && f.dataUrl ? (
              <div className="p-10 text-center text-sm text-gray-300">Preview not available for this file type. Use Download to open it.</div>
            ) : (
              <div className="p-10 text-center text-sm text-amber-300"><Icon name="file-x" className="mx-auto mb-2 h-7 w-7" />No file uploaded by the customer yet.</div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Note to the customer about this document</label>
            <div className="flex items-stretch gap-2">
              <textarea value={note} onChange={(e) => onNote(e.target.value)} rows={2} placeholder="e.g. Please re-upload a clearer scan" className="pn-input flex-1 resize-none" />
              <button onClick={onSaveNote} title="Save note" className="pn-btn pn-btn-primary"><Icon name="save" className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
