import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Archive, Edit2, Plus, RotateCcw } from 'lucide-react';
import { listContent, createContent, updateContent, archiveContent, restoreContent } from '../../services/adminContentService.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';

const TYPE = 'faqs';

const BLANK_FAQ = { question: '', answer: '', category: 'general' };

export default function AdminContent() {
  const { toast } = useToast();
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();
  // Live rows load on first open, archived rows on request.
  const [loaded, setLoaded] = useState({});
  const asked = useRef(new Set());
  const [faqs, setFaqs] = useState([]);
  const [editModal, setEditModal] = useState(null);
  const [editData, setEditData] = useState({});

  const load = (archived) => {
    if (asked.current.has(archived)) return;
    asked.current.add(archived);
    listContent(TYPE, { archived }).then((rows) => {
      setFaqs((prev) => [...prev.filter((x) => x.archived !== archived), ...rows]);
      setLoaded((l) => ({ ...l, [archived ? 'archived' : 'live']: true }));
    }).catch((err) => {
      asked.current.delete(archived);
      toast(err?.message || `Could not load ${archived ? 'archived ' : ''}FAQs.`, 'error');
    });
  };

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- `load` is redeclared every render and reads no changing input.

  const activeFaqs = useMemo(() => faqs.filter((f) => !f.archived), [faqs]);
  const archivedFaqs = useMemo(() => faqs.filter((f) => f.archived), [faqs]);

  if (flagsLoading) return <Loading />;

  if (!optionEnabled('content.enabled')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-gray-500 text-sm">Content module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </div>
    );
  }

  const openAdd = () => { setEditModal({ isNew: true }); setEditData({ ...BLANK_FAQ }); };
  const openEdit = (item) => { setEditModal({ isNew: false, id: item.id }); setEditData({ ...item }); };
  const closeMod = () => { setEditModal(null); setEditData({}); };

  // Writes replace the row with the server's response; the audit
  // row is written server-side from the authenticated principal.
  const saveItem = async () => {
    try {
      if (editModal.isNew) {
        const created = await createContent(TYPE, editData);
        setFaqs((prev) => [...prev, created]);
      } else {
        const updated = await updateContent(TYPE, editModal.id, editData);
        setFaqs((prev) => prev.map((x) => (x.id === editModal.id ? updated : x)));
      }
      toast('Saved');
      closeMod();
    } catch (err) {
      // The server names the offending field ("A faqs item needs 'question'"), which beats "Could not save".
      toast(err?.message || 'Could not save. Please try again.', 'error');
    }
  };

  const archiveItem = async (id) => {
    if (!window.confirm('Archive this FAQ? It will be hidden but preserved.')) return;
    try {
      const updated = await archiveContent(TYPE, id);
      setFaqs((prev) => prev.map((x) => (x.id === id ? updated : x)));
      toast('Archived');
    } catch {
      toast('Could not archive. Please try again.', 'error');
    }
  };

  const restoreItem = async (id) => {
    if (!window.confirm('Restore this FAQ?')) return;
    try {
      const updated = await restoreContent(TYPE, id);
      setFaqs((prev) => prev.map((x) => (x.id === id ? updated : x)));
      toast('Restored', 'success');
    } catch {
      toast('Could not restore. Please try again.', 'error');
    }
  };

  const archivedNote = loaded.archived ? `, ${archivedFaqs.length} archived` : '';

  return (
    <div>
      <PageHeader title="Content" subtitle="Manage FAQs. The first 6 also appear on the Home page." />

      {!loaded.live ? <Loading /> : (
        <div>
          <div className="mb-3 flex justify-between"><p className="text-xs text-gray-400">Frequently asked questions. ({activeFaqs.length} active{archivedNote})</p><button onClick={openAdd} className="dz-btn dz-btn-primary"><Plus className="h-4 w-4" />Add FAQ</button></div>
          <div className="space-y-2">
            {activeFaqs.map((f) => (
              <div key={f.id} className="dz-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold">{f.question}</div><div className="mt-1 text-sm text-gray-400 line-clamp-2">{f.answer}</div></div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => openEdit(f)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => archiveItem(f.id)} title="Archive" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
            {!activeFaqs.length ? <p className="text-sm text-gray-500">No FAQs yet.</p> : null}
          </div>
          {archivedFaqs.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Archived</p>
              <div className="space-y-2 opacity-60">
                {archivedFaqs.map((f) => (
                  <div key={f.id} className="dz-card p-4 border-dashed">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="font-semibold">{f.question}</div></div>
                      <button onClick={() => restoreItem(f.id)} title="Restore" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-1.5 text-emerald-300"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {loaded.archived ? null : (
            <button type="button" onClick={() => load(true)} className="mt-4 text-xs text-gray-400 underline underline-offset-2 hover:text-white">Show archived</button>
          )}
        </div>
      )}

      {editModal ? (
        <Modal open={true} onClose={closeMod} title={`${editModal.isNew ? 'Add' : 'Edit'} faq`} size="md"
          footer={<><button onClick={closeMod} className="dz-btn dz-btn-ghost">Cancel</button>
            <button onClick={saveItem} className="dz-btn dz-btn-primary">Save</button></>}
        >
          <div className="space-y-3">
            <label className="block text-sm"><span className="mb-1 block text-gray-400">Question</span>
              <input value={editData.question || ''} onChange={(e) => setEditData((d) => ({ ...d, question: e.target.value }))} className="dz-input" /></label>
            <label className="block text-sm"><span className="mb-1 block text-gray-400">Answer</span>
              <textarea rows={3} value={editData.answer || ''} onChange={(e) => setEditData((d) => ({ ...d, answer: e.target.value }))} className="dz-input" /></label>
            <label className="block text-sm"><span className="mb-1 block text-gray-400">Category</span>
              <input value={editData.category || ''} onChange={(e) => setEditData((d) => ({ ...d, category: e.target.value }))} className="dz-input" /></label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}