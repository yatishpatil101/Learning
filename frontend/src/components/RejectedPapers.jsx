import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { addServiceRequestDoc, readServiceRequestChecklist } from '../services/serviceRequestService.js';
/** The rent-agreement papers the desk sent back, each with its reason and a re-upload. */

export default function RejectedPapers({ requestId, onUploaded }) {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    readServiceRequestChecklist(requestId)
      .then((res) => { if (alive) setItems(res.items.filter((i) => i.review === 'rejected' && i.canUpload)); })
      .catch((error) => console.warn('[rejected-papers] checklist failed', error));
    return () => { alive = false; };
  }, [requestId, nonce]);

  const upload = async (item, file) => {
    if (!file || busy) return;
    setBusy(item.id);
    try {
      await addServiceRequestDoc(requestId, { file, category: item.id });
      toast(`${item.name} re-uploaded. Our team will check it again.`, 'success');
      setNonce((n) => n + 1);
      onUploaded?.();
    } catch (error) {
      toast(error?.message || 'The upload failed. Please try again.', 'error');
    } finally {
      setBusy('');
    }
  };

  if (items.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3" role="region" aria-label="Documents to re-upload">
      <p className="text-rose-200 text-xs font-semibold mb-2 flex items-center gap-1.5">
        <Icon name="alert-triangle" className="w-3.5 h-3.5" /> Our team needs a fresh copy of {items.length === 1 ? 'one document' : `${items.length} documents`}
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="text-xs">
            <p className="text-white font-medium">{it.name}</p>
            {it.reason ? <p className="text-rose-200/90 mt-0.5">{it.reason}</p> : null}
            <label className="mt-1.5 inline-flex items-center gap-1.5 btn-outline px-3 py-1.5 rounded-lg text-gray-200 font-semibold cursor-pointer">
              <Icon name="upload" className="w-3.5 h-3.5" /> {busy === it.id ? 'Uploading…' : 'Upload a new copy'}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="sr-only"
                disabled={!!busy}
                aria-label={`Upload a new copy of ${it.name}`}
                onChange={(event) => { upload(it, event.target.files?.[0]); event.target.value = ''; }}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
